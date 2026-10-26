'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const P=require('./policy.cjs'),old=require('./policy-1.1.0.cjs');
test('case-only titles preserve literal source spelling and their supported dates',()=>{
 const page={title:'',text:'REGULAR GRANT PROGRAMME\nApplications close 30 November 2026.'};const value={candidates:[{title:'Regular Grant Programme',titleQuote:'REGULAR GRANT PROGRAMME',closesOn:'2026-11-30',closesQuote:'Applications close 30 November 2026.'}]};
 const result=P.validateDetails(value,page);assert.equal(result.candidates[0].title,'REGULAR GRANT PROGRAMME');assert.equal(result.candidates[0].closesOn,'2026-11-30');assert.equal(old.validateDetails(value,page).candidates.length,0);
 assert.notEqual(P.POLICY_HASH,old.POLICY_HASH);assert.equal(P.TEMPLATE,old.TEMPLATE);assert.deepEqual(P.RESULT_SCHEMA,old.RESULT_SCHEMA);
});
test('quote grounding stays literal and invented words or regex syntax do not pass',()=>{
 const page={title:'',text:'ALPHA (RESEARCH) GRANT\nApplications close 30 November 2026.'};
 assert.equal(P.validateDetails({candidates:[{title:'Alpha (Research) Grant',titleQuote:'ALPHA (RESEARCH) GRANT'}]},page).candidates[0].title,'ALPHA (RESEARCH) GRANT');
 for(const candidate of [{title:'Alpha Advanced Grant',titleQuote:'ALPHA (RESEARCH) GRANT'},{title:'Alpha (Research) Grant',titleQuote:'Alpha (Research) Grant'},{title:'.*GRANT',titleQuote:'ALPHA (RESEARCH) GRANT'}])assert.equal(P.validateDetails({candidates:[candidate]},page).candidates.length,0);
});
test('contiguous labels and values stay together while omitted source stays separated',()=>{
 const source='Menu\n'.repeat(200)+'ALPHA RESEARCH GRANT\nAn invitation to submit research proposals for funded projects.\nAPPLICATIONS CLOSE\n30 November 2026\n'+'unrelated footer content '.repeat(200);
 const page=P.packPage({title:'Alpha Research Grant',url:'https://unit-test.invalid/alpha-research-grant',text:source});assert(page.text.length<=3400);assert(page.text.includes('APPLICATIONS CLOSE\n30 November 2026'));assert(page.text.includes('An invitation'));assert(page.truncated);
 for(const span of page.text.split('[omitted content]').map(s=>s.trim()).filter(Boolean))assert(source.includes(span),'Every packed section must be a literal contiguous source span');
 const result=P.validateDetails({candidates:[{title:'Alpha Research Grant',titleQuote:'ALPHA RESEARCH GRANT',closesOn:'2026-11-30',closesQuote:'APPLICATIONS CLOSE 30 November 2026'}]},page);assert.equal(result.candidates[0].closesOn,'2026-11-30');
});
test('profiles retain the identity and opening biography ahead of navigation and country selectors',()=>{
 const nav=('Research\nFunding & Competitions\nAwards Program\nCollege of Fellows\n').repeat(60),biography='People\nPeter Weismantle\nCompany\nArchitecture Studio\nAbout\nPeter Weismantle is an architect responsible for the design and development of tall buildings. He is a member of a professional association, not a funded fellowship applicant.\n';
 const text=nav+biography+'Country\nAfghanistan\nAlbania\n'.repeat(100)+'Company\nFooter';const page=P.packPage({url:'https://unit-test.invalid/people-profile/peter-weismantle/',text});assert(page.text.includes('Peter Weismantle is an architect'));assert(page.text.includes('Peter Weismantle\nCompany'));assert(page.text.length<=3400);
 assert(P.packPage({url:'https://unit-test.invalid/people-profile/peter-weismantl/',text}).text.includes('Peter Weismantle is an architect'));
});
test('existing date safeguards remain independent of title capitalization',()=>{
 assert(!P.applicationDate('opensOn','2026-11-18','Proposals accepted until November 18th, 2026.'));assert(!P.groundedDate('2026-11-10','Deadline 10/11/2026'));assert(!P.groundedDate('2026-10-31','Applications close October 31'));assert(!P.applicationDate('closesOn','2026-11-30','Project completion 30 November 2026'));
 const page=P.packPage({title:'Calls',url:'https://unit-test.invalid/calls',text:'Pilot Grant\nApplications close 30 November 2026.\nResearch Grant\nApplications close 31 December 2026.'});const details=P.validateDetails({multipleCalls:true,candidates:[{title:'Pilot Grant',titleQuote:'Pilot Grant',closesOn:'2026-12-31',closesQuote:'Applications close 30 November 2026.'},{title:'Research Grant',titleQuote:'Research Grant',closesOn:'2026-12-31',closesQuote:'Applications close 31 December 2026.'}]},page);assert(details.multipleCalls);assert.equal(details.candidates[0].closesOn,null);assert.equal(details.candidates[1].closesOn,'2026-12-31');
});
