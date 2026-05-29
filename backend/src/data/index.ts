export type { Region } from './regions';
export type { Province } from './provinces';
export type { District } from './districts';

export { REGIONS } from './regions';
export { PROVINCES } from './provinces';
export { DISTRICTS } from './districts';

import { REGIONS } from './regions';
import { PROVINCES } from './provinces';
import { DISTRICTS } from './districts';
import type { Region } from './regions';
import type { Province } from './provinces';
import type { District } from './districts';

// ── Lookup maps (built once at module load time) ─────────────────────────────

const regionByCode = new Map<string, Region>(REGIONS.map((r) => [r.code, r]));
const provinceByCode = new Map<string, Province>(PROVINCES.map((p) => [p.code, p]));
const districtByCode = new Map<string, District>(DISTRICTS.map((d) => [d.code, d]));

// ── Lookup helpers ────────────────────────────────────────────────────────────

export function getRegionByCode(code: string): Region | undefined {
  return regionByCode.get(code);
}

export function getProvinceByCode(code: string): Province | undefined {
  return provinceByCode.get(code);
}

export function getDistrictByCode(code: string): District | undefined {
  return districtByCode.get(code);
}

export function getProvincesByRegion(regionCode: string): Province[] {
  return PROVINCES.filter((p) => p.regionCode === regionCode);
}

export function getDistrictsByProvince(provinceCode: string): District[] {
  return DISTRICTS.filter((d) => d.provinceCode === provinceCode);
}

export function getAllProvinces(): Province[] {
  return [...PROVINCES].sort((a, b) => a.code.localeCompare(b.code));
}

export function getAllDistricts(): District[] {
  return [...DISTRICTS].sort((a, b) => a.code.localeCompare(b.code));
}

export function getRegionNameByCode(code: string): string | undefined {
  return regionByCode.get(code)?.name;
}
