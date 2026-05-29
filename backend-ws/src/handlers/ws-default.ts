import { APIGatewayProxyHandler } from 'aws-lambda';

export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Received message on default route:', event.body);
  
  return {
    statusCode: 200,
    body: 'Message received',
  };
};
