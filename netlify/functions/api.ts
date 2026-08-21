import { app, serverPromise } from "../../server.ts";
import serverless from "serverless-http";

const expressHandler = serverless(app);

export const handler = async (event: any, context: any) => {
  await serverPromise;
  return expressHandler(event, context);
};
