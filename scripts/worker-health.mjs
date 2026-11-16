import { PrismaClient } from '@prisma/client';
const db=new PrismaClient();
try{const row=await db.workerHeartbeat.findUnique({where:{id:'notifications'}});process.exitCode=row?.lastSuccessAt&&Date.now()-row.lastSuccessAt.getTime()<120000?0:1;}catch{process.exitCode=1;}finally{await db.$disconnect();}
