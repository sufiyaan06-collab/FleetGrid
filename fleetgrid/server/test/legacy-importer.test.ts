import assert from 'node:assert/strict';
import { mapLegacySnapshot } from '../scripts/legacy-importer.js';

const valid = () => ({
  organizations: [
    {id:'org-1',name:'Example Shipper',type:'SHIPPER',status:'ACTIVE',created_at:null},
    {id:'org-2',name:'Example Fleet',type:'FLEET_OPERATOR',status:'ACTIVE',created_at:null},
  ],
  users: [
    {id:'user-1',name:'Example Shipper User',email:'private@example.invalid',role:'SHIPPER',organization_id:'org-1',contact:null,created_at:null},
    {id:'user-2',name:'Example Driver',email:'driver@example.invalid',role:'DRIVER',organization_id:'org-2',contact:null,created_at:null},
  ],
  drivers: [{id:'driver-1',organization_id:'org-2',user_id:'user-2',assigned_truck_id:null,status:'AVAILABLE'}],
  trucks: [{id:'truck-1',organization_id:'org-2',registration_no:'KA01AB1234',capacity_t:20,available_t:12,status:'AVAILABLE',lat:null,lng:null,origin:null,destination:null,departure_at:null,driver_id:'driver-1',speed_kmph:null,heading:null,location_status:null,last_location_update:null}],
  capacity_offers: [{id:'offer-1',truck_id:'truck-1',route:'Bengaluru -> Chennai',available_t:12,departure_at:null,status:'OPEN',price_rule:'INR 2500 per Ton'}],
  shipments: [{id:'shipment-1',shipper_id:'org-1',origin:'Bengaluru',destination:'Chennai',weight_t:4,deadline_at:null,status:'DRAFT',truck_id:null,price:0,currency:'INR',created_at:null}],
  shipment_events: [{id:'event-1',shipment_id:'shipment-1',event_type:'CREATED',payload_json:'{"source":"legacy"}',actor_type:'SHIPPER',actor_id:'user-1',timestamp:null,hash:'abc',blockchain_tx:null,proof_status:'FALLBACK_RECORDED'}],
  incidents: [{id:'incident-1',truck_id:'truck-1',type:'BREAKDOWN',location:'NH48',severity:null,transcript:null,structured_summary:null,status:'OPEN',created_at:null}],
  recovery_plans: [{id:'plan-1',incident_id:'incident-1',affected_shipment_ids:'[]',options_json:'[]',selected_truck_id:null,cost:0,eta_delta_minutes:0,status:'DRAFT',approved_by:null,approved_at:null,created_at:null}],
  payments: [{id:'payment-1',shipment_id:'shipment-1',recovery_plan_id:null,provider:null,amount:100,currency:null,status:'CREATED',provider_reference:'private-provider-ref',created_at:null}],
  notifications: [{id:'notification-1',recipient_id:'user-1',type:'DELIVERY_UPDATE',message:'A shipment changed',status:'UNREAD',created_at:null}],
});

const report = mapLegacySnapshot(valid());
assert.equal(report.readOnly,true);
assert.equal(report.summary.organizations.mapped,2);
assert.equal(report.summary.users.mapped,2);
assert.equal(report.summary.drivers.mapped,1);
assert.equal(report.summary.trucks.mapped,1);
assert.equal(report.summary['capacity_offers'].mapped,1);
assert.equal(report.summary.shipments.mapped,1);
assert.equal(report.summary.shipment_events.mapped,1);
assert.equal(report.summary.incidents.mapped,1);
assert.equal(report.summary.recovery_plans.mapped,1);
assert.equal(report.summary.payments.mapped,0);
assert.equal(report.summary.payments.quarantined,1);
assert.equal(report.records.find(r=>r.sourceTable==='payments')?.outcome,'quarantined');
assert.equal(report.summary.notifications.mapped,1);

const user = report.records.find(r=>r.sourceTable==='users')?.data;
assert.equal(user?.role,'BUSINESS');
assert.equal(user?.organizationId,'org-1');
assert.equal(user?.contact,null);
assert.equal(user?.createdAt,null);
assert.equal('email' in (user??{}),false,'email must never enter public user data');

const driver=report.records.find(r=>r.sourceTable==='drivers')?.data;
assert.equal(driver?.name,'Example Driver');
assert.equal(driver?.phone,null);
assert.equal(driver?.createdAt,null);

const truck=report.records.find(r=>r.sourceTable==='trucks')?.data;
assert.equal(truck?.lat,null);
assert.equal(truck?.lng,null);
assert.equal(truck?.speedKmph,null);
assert.equal(truck?.heading,null);
assert.equal(truck?.locationStatus,null);
assert.equal(truck?.lastLocationUpdate,null);
assert.equal(truck?.origin,null);
assert.equal(truck?.destination,null);

const offer=report.records.find(r=>r.sourceTable==='capacity_offers')?.data;
assert.equal(offer?.origin,'Bengaluru');
assert.equal(offer?.destination,'Chennai');
assert.equal(offer?.pricePerT,2500);

const event=report.records.find(r=>r.sourceTable==='shipment_events')?.data;
assert.equal(event?.actorType,'BUSINESS');
assert.equal(event?.proofStatus,'FALLBACK_RECORDED');
assert.equal(event?.timestamp,null);

const incident=report.records.find(r=>r.sourceTable==='incidents')?.data;
assert.equal(incident?.type,'TRUCK_BREAKDOWN');
assert.equal(incident?.severity,null);
assert.equal(incident?.source,'LEGACY_IMPORT');
assert.equal(incident?.affectedShipmentIds,null);

const notification=report.records.find(r=>r.sourceTable==='notifications')?.data;
assert.equal(notification?.status,'UNREAD');

const onTrip=valid();
onTrip.drivers[0]!.status='ON_TRIP';
assert.equal(mapLegacySnapshot(onTrip).records.find(r=>r.sourceTable==='drivers')?.data?.status,'ON_JOURNEY');
const incidentReported=valid();
incidentReported.drivers[0]!.status='INCIDENT_REPORTED';
assert.equal(mapLegacySnapshot(incidentReported).records.find(r=>r.sourceTable==='drivers')?.data?.status,'INCIDENT_REPORTED');

const invalidTimestamp=valid();
invalidTimestamp.notifications[0]!.created_at='not-a-date';
assert.equal(mapLegacySnapshot(invalidTimestamp).records.find(r=>r.sourceTable==='notifications')?.outcome,'quarantined');

const auditorInput=valid();
auditorInput.users[0]!.role='AUDITOR';
const auditor=mapLegacySnapshot(auditorInput).records.find(r=>r.sourceTable==='users');
assert.equal(auditor?.outcome,'quarantined');
assert.ok(auditor?.issues.some(i=>i.code==='ROLE_REQUIRES_ADMIN_REVIEW'));

const unassignedInput=valid();
unassignedInput.users[0]!.organization_id=null;
const unassigned=mapLegacySnapshot(unassignedInput).records.find(r=>r.sourceTable==='users');
assert.equal(unassigned?.outcome,'quarantined');
assert.ok(unassigned?.issues.some(i=>i.code==='USER_ORGANIZATION_MISSING'));

const malformedEvent=valid();
malformedEvent.shipment_events[0]!.payload_json='{bad json';
assert.equal(mapLegacySnapshot(malformedEvent).records.find(r=>r.sourceTable==='shipment_events')?.outcome,'quarantined');

const malformedPlan=valid();
malformedPlan.recovery_plans[0]!.options_json='{bad json';
assert.equal(mapLegacySnapshot(malformedPlan).records.find(r=>r.sourceTable==='recovery_plans')?.outcome,'quarantined');

const brokenParent=valid();
brokenParent.trucks[0]!.organization_id='missing-org';
assert.equal(mapLegacySnapshot(brokenParent).records.find(r=>r.sourceTable==='trucks')?.outcome,'quarantined');

const badRoute=valid();
badRoute.capacity_offers[0]!.route='not a route';
const badRouteReport=mapLegacySnapshot(badRoute);
assert.equal(badRouteReport.records.find(r=>r.sourceTable==='capacity_offers')?.outcome,'mapped');
assert.equal(badRouteReport.records.find(r=>r.sourceTable==='capacity_offers')?.data?.origin,null);

const duplicates=valid();
duplicates.organizations.push({...duplicates.organizations[0]!});
const duplicateReport=mapLegacySnapshot(duplicates);
assert.equal(duplicateReport.summary.organizations.source,3);
assert.equal(duplicateReport.summary.organizations.quarantined,2);
assert.equal(duplicateReport.summary.organizations.mapped,1);

const missingColumn=valid();
delete (missingColumn.trucks[0] as Record<string,unknown>).capacity_t;
assert.equal(mapLegacySnapshot(missingColumn).records.filter(r=>r.sourceTable==='trucks')[0]?.issues[0]?.code,'SOURCE_SCHEMA_COLUMN_MISSING');

process.stdout.write('Legacy importer mapping tests passed.\n');
