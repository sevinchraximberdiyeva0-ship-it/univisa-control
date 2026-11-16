import pino from 'pino';
import { app } from './app.js';
import { config } from './config.js';
import { db } from './db.js';
const log=pino();
const server=app.listen(config.PORT,()=>log.info({event:'api_started',port:config.PORT}));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(async()=>{await db.$disconnect();process.exit(0);}));
