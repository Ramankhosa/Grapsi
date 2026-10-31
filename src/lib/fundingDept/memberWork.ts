/** Distinct calls with recorded activity by this person, independent of school ownership. */
export function memberWorkedCallIds(userId:string,start:Date,end:Date,facts:{
  applications:Array<{call_id:string|null;assignment_id:string|null;allocated_by:string;created_at:Date;submission_recorder:string|null;submitted_at:Date|null}>
  contacts:Array<{call_id:string|null;actor_id:string;happened_at:Date}>
  events:Array<{entity_id:string;entity_type:string;actor_user_id:string|null;occurred_at:Date;after_data:unknown}>
  visibleCallIds:Set<string>
}):Set<string> {
  const ids=new Set<string>()
  const inWindow=(date:Date|null)=>Boolean(date&&date>=start&&date<end)
  const add=(id:string|null|undefined)=>{if(id&&facts.visibleCallIds.has(id))ids.add(id)}
  for(const app of facts.applications){
    if(app.assignment_id&&app.allocated_by===userId&&inWindow(app.created_at))add(app.call_id)
    if(app.submission_recorder===userId&&inWindow(app.submitted_at))add(app.call_id)
  }
  for(const contact of facts.contacts)if(contact.actor_id===userId&&inWindow(contact.happened_at))add(contact.call_id)
  for(const event of facts.events){
    if(event.actor_user_id!==userId||!inWindow(event.occurred_at))continue
    const data=event.after_data as {call_id?:string;callId?:string}|null
    if(['REVIEW','DISPOSITION','MAPPING','ORIGIN_ATTRIBUTION'].includes(event.entity_type))add(event.entity_id)
    else if(event.entity_type==='ACTION')add(data?.call_id||data?.callId)
  }
  return ids
}
