// Untrusted Excel parsing stays outside the HTTP/auth isolate, with no inherited
// environment, a bounded heap and a parent-enforced deadline. No formulas execute.
import {parentPort,workerData} from 'node:worker_threads';
import {parseSchedule} from './thermographySchedule.js';
try{parentPort.postMessage({rows:parseSchedule(Buffer.from(workerData.bytes),workerData.filename,workerData.month)});}
catch(e){parentPort.postMessage({error:e.statusCode?e.message:'The schedule workbook could not be validated.'});}
