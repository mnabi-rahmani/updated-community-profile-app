import fs from 'fs';
import path from 'path';

const statePath = process.argv[2];
const outPath = process.argv[3];
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const svc = state.service;
const functions = svc.functions;

const lines = [];
lines.push(`service: ${svc.service}`);
lines.push('');
lines.push('frameworkVersion: "3"');
lines.push('useDotenv: true');
lines.push('');
lines.push('provider:');
lines.push('  name: aws');
lines.push(`  runtime: ${svc.provider.runtime}`);
lines.push(`  region: ${svc.provider.region ?? 'us-east-1'}`);
lines.push(`  stage: \${opt:stage, '${svc.provider.stage}'}`);
lines.push(`  memorySize: ${svc.provider.memorySize ?? 256}`);
lines.push(`  timeout: ${svc.provider.timeout ?? 29}`);
lines.push('  httpApi:');
lines.push('    cors:');
lines.push('      allowedOrigins:');
for (const o of svc.provider.httpApi?.cors?.allowedOrigins ?? ['*']) {
  lines.push(`        - '${o}'`);
}
lines.push('      allowedHeaders:');
for (const h of svc.provider.httpApi?.cors?.allowedHeaders ?? ['Content-Type', 'Authorization']) {
  lines.push(`        - '${h}'`);
}
lines.push('      allowedMethods:');
for (const m of svc.provider.httpApi?.cors?.allowedMethods ?? ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']) {
  lines.push(`        - '${m}'`);
}
lines.push('  environment:');
for (const [key, val] of Object.entries(svc.provider.environment ?? {})) {
  if (typeof val === 'object') continue;
  lines.push(`    ${key}: \${env:${key}, ''}`);
}
lines.push('  iam:');
lines.push('    role:');
lines.push('      statements:');
for (const stmt of svc.provider.iam?.role?.statements ?? []) {
  lines.push('        - Effect: Allow');
  lines.push(`          Action:`);
  for (const action of stmt.Action) {
    lines.push(`            - ${action}`);
  }
  lines.push('          Resource:');
  if (Array.isArray(stmt.Resource)) {
    for (const res of stmt.Resource) {
      if (typeof res === 'string') lines.push(`            - ${res}`);
      else lines.push(`            - Fn::GetAtt: [CommunityProfilesTable, Arn]`);
    }
  }
}

if (svc.custom) {
  lines.push('');
  lines.push('custom:');
  for (const [key, val] of Object.entries(svc.custom)) {
    if (typeof val === 'string') lines.push(`  ${key}: ${val}`);
    else if (key === 'esbuild') {
      lines.push('  esbuild:');
      for (const [ek, ev] of Object.entries(val)) {
        if (typeof ev === 'object') {
          lines.push(`    ${ek}:`);
          for (const [ek2, ev2] of Object.entries(ev)) lines.push(`      ${ek2}: ${JSON.stringify(ev2)}`);
        } else lines.push(`    ${ek}: ${ev}`);
      }
    }
  }
}

lines.push('');
lines.push('plugins:');
for (const p of svc.plugins ?? ['serverless-esbuild']) {
  lines.push(`  - ${p}`);
}

lines.push('');
lines.push('package:');
lines.push('  individually: true');
lines.push('');
lines.push('functions:');

for (const [name, fn] of Object.entries(functions)) {
  lines.push(`  ${name}:`);
  lines.push(`    handler: ${fn.handler}`);
  if (fn.timeout && fn.timeout !== (svc.provider.timeout ?? 29)) {
    lines.push(`    timeout: ${fn.timeout}`);
  }
  if (fn.events?.length) {
    lines.push('    events:');
    for (const ev of fn.events) {
      if (ev.httpApi) {
        lines.push('      - httpApi:');
        lines.push(`          path: ${ev.httpApi.path}`);
        lines.push(`          method: ${ev.httpApi.method}`);
      }
      if (ev.websocket) {
        lines.push('      - websocket:');
        lines.push(`          route: ${ev.websocket.route}`);
      }
    }
  }
  lines.push('');
}

if (svc.resources?.Resources) {
  lines.push('resources:');
  lines.push('  Resources:');
  const table = svc.resources.Resources.CommunityProfilesTable ?? svc.resources.Resources.WebSocketConnectionsTable;
  if (svc.resources.Resources.CommunityProfilesTable) {
    lines.push('    CommunityProfilesTable:');
    lines.push('      Type: AWS::DynamoDB::Table');
    lines.push('      DeletionPolicy: Retain');
    lines.push('      Properties:');
    lines.push(`        TableName: \${self:custom.tableName}`);
    lines.push('        BillingMode: PAY_PER_REQUEST');
    lines.push('        AttributeDefinitions:');
    lines.push('          - AttributeName: PK');
    lines.push('            AttributeType: S');
    lines.push('          - AttributeName: SK');
    lines.push('            AttributeType: S');
    lines.push('          - AttributeName: GSI1PK');
    lines.push('            AttributeType: S');
    lines.push('          - AttributeName: GSI1SK');
    lines.push('            AttributeType: S');
    lines.push('        KeySchema:');
    lines.push('          - AttributeName: PK');
    lines.push('            KeyType: HASH');
    lines.push('          - AttributeName: SK');
    lines.push('            KeyType: RANGE');
    lines.push('        GlobalSecondaryIndexes:');
    lines.push('          - IndexName: GSI1');
    lines.push('            KeySchema:');
    lines.push('              - AttributeName: GSI1PK');
    lines.push('                KeyType: HASH');
    lines.push('              - AttributeName: GSI1SK');
    lines.push('                KeyType: RANGE');
    lines.push('            Projection:');
    lines.push('              ProjectionType: ALL');
    lines.push('        PointInTimeRecoverySpecification:');
    lines.push('          PointInTimeRecoveryEnabled: true');
  }
  if (svc.resources.Outputs) {
    lines.push('  Outputs:');
    for (const [key, out] of Object.entries(svc.resources.Outputs)) {
      lines.push(`    ${key}:`);
      lines.push(`      Description: ${out.Description ?? key}`);
      if (typeof out.Value === 'string') lines.push(`      Value: ${out.Value}`);
    }
  }
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join('\n'));
console.log('Wrote', outPath);
