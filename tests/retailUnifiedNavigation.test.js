import test from 'node:test';import assert from 'node:assert/strict';
import {canAccessRoute,retailWebAccess} from '../src/utils/authRoles.js';
test('Retail master navigation admits existing MIS accounts without opening other module routes',()=>{
 const viewer={role:'MIS',rawRole:'MIS',business:'Reliance Retail'};
 assert.equal(retailWebAccess(viewer).master,true);assert.equal(canAccessRoute(viewer,'/reliance-retail/store-master'),true);
 assert.equal(canAccessRoute(viewer,'/reliance-retail/fault-tracker'),false);assert.equal(canAccessRoute(viewer,'/reliance-retail/deep-cleaning'),false);
 assert.equal(canAccessRoute({...viewer,business:'Standalone'},'/reliance-retail/store-master'),false);
});
