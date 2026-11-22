import assert from 'node:assert/strict';

export type LegacyRow = Record<string, unknown>;
export type MigrationOutcome = 'mapped' | 'quarantined';
export interface MigrationIssue { code: string; field?: string; severity: 'warning' | 'error'; }
export interface MigrationRecord {
  sourceTable: string;
  sourceId: string;
  collection: string | null;
  outcome: MigrationOutcome;
  data: Record<string, unknown> | null;
  issues: MigrationIssue[];
  /** Kept separate from application collections; never included in the dry-run report. */
  sourceRow: LegacyRow;
}
export interface MigrationReport {
  readOnly: true;
  summary: Record<string, { source: number; mapped: number; quarantined: number }>;
  records: MigrationRecord[];
  issues: Array<{ table: string; id: string; code: string; field?: string; severity: 'warning' | 'error' }>;
}
const TABLES = [
  'organizations','users','drivers','trucks','capacity_offers','shipments',
  'shipment_events','incidents','recovery_plans','payments','notifications',
] as const;
type TableName = typeof TABLES[number];
export type LegacyTables = Partial<Record<TableName, LegacyRow[]>>;
const COLLECTION: Record<TableName, string> = {
  organizations:'organizations', users:'users', drivers:'drivers', trucks:'trucks',
  capacity_offers:'capacity-offers', shipments:'shipments', shipment_events:'shipment-events',
  incidents:'incidents', recovery_plans:'recovery-plans', payments:'payments', notifications:'notifications',
};
export const EXPECTED_COLUMNS: Record<TableName, string[]> = {
  organizations:['id','name','type','status'],
  users:['id','name','email','role','organization_id','contact','created_at'],
  drivers:['id','organization_id','user_id','assigned_truck_id','status'],
  trucks:['id','organization_id','registration_no','capacity_t','available_t','status','lat','lng','origin','destination','departure_at','driver_id','speed_kmph','heading','location_status','last_location_update'],
  capacity_offers:['id','truck_id','route','available_t','departure_at','status','price_rule'],
  shipments:['id','shipper_id','origin','destination','weight_t','deadline_at','status','truck_id','price','currency','created_at'],
  shipment_events:['id','shipment_id','event_type','payload_json','actor_type','actor_id','timestamp','hash','blockchain_tx','proof_status'],
  incidents:['id','truck_id','type','location','severity','transcript','structured_summary','status','created_at'],
  recovery_plans:['id','incident_id','affected_shipment_ids','options_json','selected_truck_id','cost','eta_delta_minutes','status','approved_by','approved_at','created_at'],
  payments:['id','shipment_id','recovery_plan_id','provider','amount','currency','status','provider_reference','created_at'],
  notifications:['id','recipient_id','type','message','status','created_at'],
};
const str = (v: unknown): string | null => typeof v === 'string' && v.trim() ? v.trim() : null;
const num = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const iso = (v: unknown): string | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const has = (rows: LegacyRow[], id: unknown) => typeof id === 'string' && rows.some((r) => r.id === id);
function timestamp(value: unknown, issues: MigrationIssue[], field: string): string | null {
  if (value == null) return null;
  const parsed = iso(value);
  if (!parsed) issue(issues,'INVALID_TIMESTAMP','error',field);
  return parsed;
}
function issue(issues: MigrationIssue[], code: string, severity: 'warning'|'error'='error', field?: string) {
  issues.push({ code, severity, ...(field ? {field} : {}) });
}
function parseJson(value: unknown): { ok: boolean; value: unknown | null } {
  if (value == null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: true, value };
  try { return { ok: true, value: JSON.parse(value) as unknown }; }
  catch { return { ok: false, value: null }; }
}
function parseRoute(value: unknown): {origin:string;destination:string}|null {
  const route = str(value);
  if (!route) return null;
  const match = /^([^>]+?)\s*->\s*([^>]+?)$/.exec(route);
  if (!match) return null;
  const origin = match[1]?.trim(), destination = match[2]?.trim();
  return origin && destination ? {origin,destination} : null;
}
function parseInrPerTon(value: unknown): number | null {
  const rule = str(value);
  if (!rule) return null;
  const match = /^INR\s+([0-9]+(?:\.[0-9]{1,2})?)\s+per\s+Ton$/i.exec(rule);
  return match ? num(match[1]) : null;
}
const enumSet = <T extends string>(value: unknown, allowed: readonly T[]): T | null =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : null;
const TRUCK = ['AVAILABLE','ASSIGNED','LOADING','IN_TRANSIT','DELIVERED','DELAYED','INCIDENT','RECOVERY'] as const;
const SHIPMENT = ['DRAFT','CAPACITY_RESERVED','CONFIRMED','IN_TRANSIT','AT_RISK','RECOVERY','DELIVERED'] as const;
const INCIDENT_STATUS = ['OPEN','ANALYZING','PLAN_READY','RESOLVED','ESCALATED'] as const;
const RECOVERY_STATUS = ['DRAFT','PROPOSED','PENDING_APPROVAL','APPROVED','EXECUTING','COMPLETED','REJECTED'] as const;
const PAYMENT_STATUS = ['CREATED','PENDING','PAID','FAILED'] as const;
const INCIDENT_TYPE: Record<string,string> = { BREAKDOWN:'TRUCK_BREAKDOWN', TRUCK_BREAKDOWN:'TRUCK_BREAKDOWN', ACCIDENT:'ACCIDENT', DELAY:'DELAY', CARGO_DAMAGE:'CARGO_DAMAGE', ROUTE_BLOCKED:'ROUTE_BLOCKED', OTHER:'OTHER' };
const actorMap: Record<string,string> = { SHIPPER:'BUSINESS', BUSINESS:'BUSINESS', SYSTEM:'SYSTEM', AGENT:'AGENT', OPERATOR:'OPERATOR', DRIVER:'DRIVER' };

function makeRecord(table: TableName, row: LegacyRow, all: LegacyTables): MigrationRecord {
  const issues: MigrationIssue[] = [];
  const id = str(row.id);
  if (!id) issue(issues,'INVALID_OR_MISSING_PRIMARY_KEY');
  const orgs=all.organizations??[], users=all.users??[], drivers=all.drivers??[], trucks=all.trucks??[];
  const offers=all.capacity_offers??[], shipments=all.shipments??[], incidents=all.incidents??[], plans=all.recovery_plans??[];
  const mapped = (collection: string, data: Record<string,unknown>): MigrationRecord => ({
    sourceTable:table, sourceId:id??'<missing-id>', collection, outcome:issues.some(i=>i.severity==='error')?'quarantined':'mapped',
    data:issues.some(i=>i.severity==='error')?null:data, issues, sourceRow:row,
  });
  const required = (value: unknown, field: string) => { const v=str(value); if(!v) issue(issues,'REQUIRED_VALUE_MISSING','error',field); return v; };
  const relationship = (value: unknown, parent: LegacyRow[], field: string, requiredLink=false): string|null => {
    const v=str(value);
    if(!v){ if(requiredLink) issue(issues,'REQUIRED_RELATIONSHIP_MISSING','error',field); return null; }
    if(!has(parent,v)){ issue(issues,requiredLink?'REQUIRED_PARENT_NOT_FOUND':'OPTIONAL_RELATIONSHIP_NOT_FOUND',requiredLink?'error':'warning',field); return null; }
    return v;
  };
  switch(table) {
    case 'organizations': {
      const type=enumSet(row.type,['SHIPPER','FLEET_OPERATOR'] as const);
      const status=enumSet(row.status,['ACTIVE','SUSPENDED'] as const);
      if(!type) issue(issues,'UNKNOWN_OR_NULL_ORGANIZATION_TYPE','error','type');
      if(!status) issue(issues,'UNKNOWN_OR_NULL_ORGANIZATION_STATUS','error','status');
      return mapped(COLLECTION[table],{id,name:required(row.name,'name'),type,status,createdAt:timestamp(row.created_at,issues,'created_at')});
    }
    case 'users': {
      const roleMap: Record<string,string>={SHIPPER:'BUSINESS',DRIVER:'DRIVER',OPERATOR:'OPERATOR'};
      const role=typeof row.role==='string'?roleMap[row.role]:undefined;
      if(!role) issue(issues,row.role==='AUDITOR'?'ROLE_REQUIRES_ADMIN_REVIEW':'UNKNOWN_OR_NULL_ROLE','error','role');
      const organizationId=relationship(row.organization_id,orgs,'organizationId',false);
      const linkedOrg=orgs.find(org=>org.id===organizationId);
      if(organizationId && linkedOrg && ((role==='BUSINESS' && linkedOrg.type!=='SHIPPER') || (role!=='BUSINESS' && linkedOrg.type!=='FLEET_OPERATOR'))) {
        issue(issues,'USER_ORGANIZATION_ROLE_MISMATCH','error','organization_id');
      }
      return mapped(COLLECTION[table],{id,name:required(row.name,'name'),role,organizationId,contact:str(row.contact),createdAt:timestamp(row.created_at,issues,'created_at')});
    }
    case 'drivers': {
      const userId=relationship(row.user_id,users,'userId',true);
      relationship(row.organization_id,orgs,'organizationId',true);
      const user=users.find(u=>u.id===userId);
      if(user && user.role!=='DRIVER') issue(issues,'DRIVER_LINKED_USER_ROLE_MISMATCH','error','user_id');
      if(user && str(user.organization_id) && str(user.organization_id)!==str(row.organization_id)) issue(issues,'DRIVER_USER_ORGANIZATION_MISMATCH','error','organization_id');
      const statusMap: Record<string,string>={AVAILABLE:'AVAILABLE',ON_TRIP:'ON_JOURNEY',ON_JOURNEY:'ON_JOURNEY',OFF_DUTY:'OFF_DUTY',INCIDENT_REPORTED:'INCIDENT_REPORTED'};
      const status=typeof row.status==='string'?statusMap[row.status]:undefined;
      if(!status) issue(issues,'UNKNOWN_OR_NULL_DRIVER_STATUS','error','status');
      const assignedTruckId=relationship(row.assigned_truck_id,trucks,'assignedTruckId');
      return mapped(COLLECTION[table],{id,organizationId:str(row.organization_id),userId,name:str(user?.name),phone:null,assignedTruckId,status,createdAt:null});
    }
    case 'trucks': {
      relationship(row.organization_id,orgs,'organizationId',true);
      const status=enumSet(row.status,TRUCK);
      if(!status) issue(issues,'UNKNOWN_OR_NULL_TRUCK_STATUS','error','status');
      const driverId=relationship(row.driver_id,drivers,'driverId');
      const capacityT=num(row.capacity_t), availableT=num(row.available_t);
      if(capacityT===null) issue(issues,'INVALID_CAPACITY','error','capacity_t');
      if(availableT===null) issue(issues,'INVALID_AVAILABLE_CAPACITY','error','available_t');
      return mapped(COLLECTION[table],{id,organizationId:str(row.organization_id),registrationNo:required(row.registration_no,'registration_no'),capacityT,availableT,status,lat:num(row.lat),lng:num(row.lng),origin:str(row.origin),destination:str(row.destination),departureAt:timestamp(row.departure_at,issues,'departure_at'),driverId,createdAt:null});
    }
    case 'capacity_offers': {
      relationship(row.truck_id,trucks,'truckId',true);
      const route=parseRoute(row.route);
      if(!route) issue(issues,'ROUTE_NOT_PARSEABLE','warning','route');
      const statusMap:Record<string,string>={OPEN:'OPEN',RESERVED:'HELD',HELD:'HELD',CLOSED:'CLOSED'};
      const status=typeof row.status==='string'?statusMap[row.status]:undefined;
      if(!status) issue(issues,'UNKNOWN_OR_NULL_CAPACITY_STATUS','error','status');
      const availableT=num(row.available_t);
      if(availableT===null) issue(issues,'INVALID_AVAILABLE_CAPACITY','error','available_t');
      const pricePerT=parseInrPerTon(row.price_rule);
      if(pricePerT===null) issue(issues,'PRICE_RULE_NOT_EXPLICIT_INR_PER_TON','warning','price_rule');
      return mapped(COLLECTION[table],{id,truckId:str(row.truck_id),route:str(row.route),origin:route?.origin??null,destination:route?.destination??null,availableT,departureAt:timestamp(row.departure_at,issues,'departure_at'),status,priceRule:str(row.price_rule),pricePerT,updatedAt:null});
    }
    case 'shipments': {
      relationship(row.shipper_id,orgs,'shipperId',true);
      const truckId=relationship(row.truck_id,trucks,'truckId');
      const status=enumSet(row.status,SHIPMENT);
      if(!status) issue(issues,'UNKNOWN_OR_NULL_SHIPMENT_STATUS','error','status');
      const weightT=num(row.weight_t), price=num(row.price);
      if(weightT===null) issue(issues,'INVALID_WEIGHT','error','weight_t');
      if(price===null) issue(issues,'PRICE_UNKNOWN_NOT_PAYABLE','warning','price');
      const currency=str(row.currency);
      if(!currency) issue(issues,'SHIPMENT_CURRENCY_UNKNOWN_NOT_PAYABLE','warning','currency');
      if(price===0) issue(issues,'ZERO_PRICE_NOT_PAYABLE','warning','price');
      return mapped(COLLECTION[table],{id,reference:null,cargoName:null,shipperId:str(row.shipper_id),origin:required(row.origin,'origin'),destination:required(row.destination,'destination'),weightT,deadlineAt:timestamp(row.deadline_at,issues,'deadline_at'),status,truckId,capacityOfferId:null,price,currency,createdAt:timestamp(row.created_at,issues,'created_at'),updatedAt:null});
    }
    case 'shipment_events': {
      relationship(row.shipment_id,shipments,'shipmentId',true);
      const parsedPayload=parseJson(row.payload_json);
      const payload=parsedPayload.value;
      if(!parsedPayload.ok || payload===null || typeof payload!=='object' || Array.isArray(payload)) issue(issues,'EVENT_PAYLOAD_NOT_JSON_OBJECT','error','payload_json');
      const actor= row.actor_type==null ? null : (typeof row.actor_type==='string'?actorMap[row.actor_type]:undefined);
      if(row.actor_type!=null && !actor) issue(issues,'UNKNOWN_EVENT_ACTOR','error','actor_type');
      const proof=row.proof_status==null ? null : enumSet(row.proof_status,['PENDING','CONFIRMED','FAILED','FALLBACK_RECORDED'] as const);
      if(row.proof_status!=null && !proof) issue(issues,'UNKNOWN_PROOF_STATUS','error','proof_status');
      return mapped(COLLECTION[table],{id,shipmentId:str(row.shipment_id),incidentId:null,truckId:null,eventType:required(row.event_type,'event_type'),payload,actorType:actor??null,actorId:str(row.actor_id),timestamp:timestamp(row.timestamp,issues,'timestamp'),hash:required(row.hash,'hash'),blockchainTx:str(row.blockchain_tx),proofStatus:proof??null});
    }
    case 'incidents': {
      relationship(row.truck_id,trucks,'truckId',true);
      const type=typeof row.type==='string'?INCIDENT_TYPE[row.type]:undefined;
      if(!type) issue(issues,'UNKNOWN_OR_NULL_INCIDENT_TYPE','error','type');
      const status=enumSet(row.status,INCIDENT_STATUS);
      if(!status) issue(issues,'UNKNOWN_OR_NULL_INCIDENT_STATUS','error','status');
      const severity=enumSet(row.severity,['LOW','MEDIUM','HIGH','CRITICAL'] as const);
      return mapped(COLLECTION[table],{id,truckId:str(row.truck_id),type,location:required(row.location,'location'),severity,transcript:str(row.transcript),structuredSummary:str(row.structured_summary),status,source:'LEGACY_IMPORT',affectedShipmentIds:null,recoveryPlanId:null,createdAt:timestamp(row.created_at,issues,'created_at'),updatedAt:null});
    }
    case 'recovery_plans': {
      relationship(row.incident_id,incidents,'incidentId',true);
      const affectedParsed=parseJson(row.affected_shipment_ids);
      const optionsParsed=parseJson(row.options_json);
      const affected=affectedParsed.value, options=optionsParsed.value;
      if(!affectedParsed.ok) issue(issues,'MALFORMED_AFFECTED_SHIPMENT_IDS','error','affected_shipment_ids');
      if(!optionsParsed.ok) issue(issues,'MALFORMED_RECOVERY_OPTIONS','error','options_json');
      if(affected!==null && (!Array.isArray(affected)||!affected.every(v=>typeof v==='string'))) issue(issues,'INVALID_AFFECTED_SHIPMENT_IDS','error','affected_shipment_ids');
      if(options!==null && (!Array.isArray(options))) issue(issues,'INVALID_RECOVERY_OPTIONS','error','options_json');
      if(Array.isArray(affected)) for(const sid of affected) if(!has(shipments,sid)) issue(issues,'RECOVERY_OPTION_SHIPMENT_NOT_FOUND','error','affected_shipment_ids');
      if(Array.isArray(options)) for(const option of options) {
        if(!option || typeof option!=='object' || Array.isArray(option)) { issue(issues,'INVALID_RECOVERY_OPTION_SHAPE','error','options_json'); continue; }
        const o=option as Record<string,unknown>;
        if(typeof o.truckId!=='string' || num(o.availableT)===null || num(o.etaMinutes)===null || num(o.distanceKm)===null || num(o.cost)===null || typeof o.currency!=='string' || typeof o.compatible!=='boolean' || typeof o.reason!=='string') {
          issue(issues,'INVALID_RECOVERY_OPTION_SHAPE','error','options_json'); continue;
        }
        if(!has(trucks,o.truckId)) issue(issues,'RECOVERY_OPTION_TRUCK_NOT_FOUND','error','options_json');
      }
      const selectedTruckId=relationship(row.selected_truck_id,trucks,'selectedTruckId');
      const status=enumSet(row.status,RECOVERY_STATUS);
      if(!status) issue(issues,'UNKNOWN_OR_NULL_RECOVERY_STATUS','error','status');
      const cost=num(row.cost), etaDeltaMinutes=num(row.eta_delta_minutes);
      return mapped(COLLECTION[table],{id,incidentId:str(row.incident_id),affectedShipmentIds:affected,options,selectedTruckId,cost,etaDeltaMinutes,status,approvedBy:str(row.approved_by),approvedAt:timestamp(row.approved_at,issues,'approved_at'),createdAt:timestamp(row.created_at,issues,'created_at'),updatedAt:null});
    }
    case 'payments': {
      const shipmentId=relationship(row.shipment_id,shipments,'shipmentId');
      const recoveryPlanId=relationship(row.recovery_plan_id,plans,'recoveryPlanId');
      const status=enumSet(row.status,PAYMENT_STATUS);
      if(!status) issue(issues,'UNKNOWN_OR_NULL_PAYMENT_STATUS','error','status');
      const amount=num(row.amount);
      if(amount===null) issue(issues,'INVALID_PAYMENT_AMOUNT','error','amount');
      const currency=str(row.currency), provider=str(row.provider);
      if(!currency||!provider) issue(issues,'PAYMENT_NEEDS_PROVIDER_RECONCILIATION','warning');
      // A legacy payment must not appear settled/actionable until reconciled with its provider.
      issue(issues,'PAYMENT_REQUIRES_PROVIDER_RECONCILIATION','error');
      return mapped(COLLECTION[table],{id,shipmentId,recoveryPlanId,provider,amount,currency,status,providerReference:null,createdAt:timestamp(row.created_at,issues,'created_at'),updatedAt:null});
    }
    case 'notifications': {
      const status=enumSet(row.status,['UNREAD','READ','SENT'] as const);
      if(!status) issue(issues,'UNKNOWN_OR_NULL_NOTIFICATION_STATUS','error','status');
      return mapped(COLLECTION[table],{id,recipientId:required(row.recipient_id,'recipient_id'),type:required(row.type,'type'),message:required(row.message,'message'),status,createdAt:timestamp(row.created_at,issues,'created_at')});
    }
  }
}

export function mapLegacySnapshot(input: LegacyTables): MigrationReport {
  const all = Object.fromEntries(TABLES.map(t=>[t,input[t]??[]])) as Record<TableName, LegacyRow[]>;
  const records: MigrationRecord[]=[];
  const sourceCounts=Object.fromEntries(TABLES.map(table=>[table,all[table].length])) as Record<TableName,number>;
  for(const table of TABLES) {
    const ids=new Set<string>();
    const duplicateIds=new Set<string>();
    for(const row of all[table]) {
      const rowId=str(row.id);
      if(rowId && ids.has(rowId)) duplicateIds.add(rowId);
      if(rowId) ids.add(rowId);
    }
    if(duplicateIds.size) {
      for(const row of all[table]) if(duplicateIds.has(str(row.id)??'')) records.push({
        sourceTable:table,sourceId:str(row.id)??'<missing-id>',collection:null,outcome:'quarantined',data:null,
        issues:[{code:'DUPLICATE_SOURCE_PRIMARY_KEY',field:'id',severity:'error'}],sourceRow:row,
      });
      all[table]=all[table].filter(row=>!duplicateIds.has(str(row.id)??''));
    }
    let missingColumn: string | null = null;
    for(const column of EXPECTED_COLUMNS[table]) {
      const rows=all[table];
      if(rows.length && rows.some(row=>!(column in row))) { missingColumn=column; break; }
    }
    if(missingColumn) {
      for(const row of all[table]) records.push({sourceTable:table,sourceId:str(row.id)??'<missing-id>',collection:null,outcome:'quarantined',data:null,issues:[{code:'SOURCE_SCHEMA_COLUMN_MISSING',field:missingColumn,severity:'error'}],sourceRow:row});
      continue;
    }
    for(const row of all[table]) records.push(makeRecord(table,row,all));
  }
  // A row with a broken FK should be quarantined; optional references are warnings and null.
  const summary: MigrationReport['summary']={};
  for(const table of TABLES) {
    const tableRecords=records.filter(r=>r.sourceTable===table);
    summary[table]={source:sourceCounts[table],mapped:tableRecords.filter(r=>r.outcome==='mapped').length,quarantined:tableRecords.filter(r=>r.outcome==='quarantined').length};
  }
  const issues=records.flatMap(r=>r.issues.map(i=>({table:r.sourceTable,id:r.sourceId,code:i.code,...(i.field?{field:i.field}:{}),severity:i.severity})));
  return {readOnly:true,summary,records,issues};
}

export function assertSourceTables(input: LegacyTables): void {
  assert.ok(input && typeof input==='object','Legacy snapshot must be an object.');
  for(const table of Object.keys(input)) assert.ok((TABLES as readonly string[]).includes(table),`Unexpected source table: ${table}`);
}
