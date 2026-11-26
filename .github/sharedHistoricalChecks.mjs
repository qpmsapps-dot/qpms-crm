import {show,git,workflowPath} from './sharedIntegrity.mjs';
import {approvedBase,manifestPath,verifyPayload} from './retailAttendanceCorrectionGuard.mjs';
export const correctionRelease='d082110bc1dd3d22fa3ece26c3a8356073077a6d';
export function verifyHistoricalCorrection(){
 const hash=p=>git(['rev-parse',`${correctionRelease}:${p}`]).trim();
 return verifyPayload({base:approvedBase,paths:git(['diff','--name-only',approvedBase,correctionRelease]).trim().split('\n'),manifest:JSON.parse(show(correctionRelease,manifestPath)),hash,workflow:show(correctionRelease,workflowPath),baseWorkflow:show(approvedBase,workflowPath)});
}
