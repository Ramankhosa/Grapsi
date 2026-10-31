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

test('an observed RFP URL cannot displace the opening invitation and deadline',()=>{
 const text='Summary\nWe are launching a funding call for developing novel interventions to improve fish welfare in India.\nProposals will be accepted until November 18th, 2026.\nBackground\n'+'Detailed research background and programme information. '.repeat(75)+'\nSee the full RFP\n[http://fwi.fish/India-RFP]\nA staffer monitoring water quality.\nMore background. '.repeat(8);
 const page=P.packPage({title:'Open Call: Funding New Ideas',url:'https://unit-test.invalid/post/rfp-india',text});
 assert(page.text.includes('We are launching a funding call'));assert(page.text.includes('Proposals will be accepted until November 18th, 2026.'));assert(page.text.length<=3400);
});
test('existing date safeguards remain independent of title capitalization',()=>{
 assert(!P.applicationDate('opensOn','2026-11-18','Proposals accepted until November 18th, 2026.'));assert(!P.groundedDate('2026-11-10','Deadline 10/11/2026'));assert(!P.groundedDate('2026-10-31','Applications close October 31'));assert(!P.applicationDate('closesOn','2026-11-30','Project completion 30 November 2026'));
 const page=P.packPage({title:'Calls',url:'https://unit-test.invalid/calls',text:'Pilot Grant\nApplications close 30 November 2026.\nResearch Grant\nApplications close 31 December 2026.'});const details=P.validateDetails({multipleCalls:true,candidates:[{title:'Pilot Grant',titleQuote:'Pilot Grant',closesOn:'2026-12-31',closesQuote:'Applications close 30 November 2026.'},{title:'Research Grant',titleQuote:'Research Grant',closesOn:'2026-12-31',closesQuote:'Applications close 31 December 2026.'}]},page);assert(details.multipleCalls);assert.equal(details.candidates[0].closesOn,null);assert.equal(details.candidates[1].closesOn,'2026-12-31');
});
test('deadlines and openings written in the funders\' own languages are recognised',()=>{
 // 30 Oct 2026: a correct gpt-5.2 close date from sls.se was rejected for its Swedish wording.
 for(const [value,quote] of [
  ['2026-02-01','Sista ansökningsdag är 1 februari 2026.'],['2026-02-01','Bewerbungsschluss: 1. Februar 2026'],['2026-03-15','Ansøgningsfrist: 15. marts 2026'],
  ['2026-02-01','Date limite : 1er février 2026'],['2026-02-01','Plazo de presentación: hasta el 1 de febrero de 2026'],['2026-05-31','Scadenza: 31 maggio 2026'],
  ['2026-09-30','Søknadsfrist 30. september 2026'],['2026-12-01','Sluitingsdatum: 1 december 2026'],['2026-08-15','Prazo de submissão: 15 de agosto de 2026'],
 ])assert(P.applicationDate('closesOn',value,quote),quote);
 assert(P.applicationDate('opensOn','2026-01-10','Ansökan öppnar 10 januari 2026.'));
 assert(P.applicationDate('opensOn','2026-03-01','Bewerbungsbeginn ab dem 1. März 2026'));
 // A Swedish opening is not a deadline, a deadline is not an opening, and the wrong day never passes.
 assert(!P.applicationDate('closesOn','2026-01-10','Ansökan öppnar 10 januari 2026.'));
 assert(!P.applicationDate('opensOn','2026-02-01','Sista ansökningsdag är 1 februari 2026.'));
 assert(!P.applicationDate('closesOn','2026-02-02','Sista ansökningsdag är 1 februari 2026.'));
 assert(!P.applicationDate('closesOn','2026-02-01','Ansökan öppnar 10 januari 2026, sista ansökningsdag 1 februari 2026.'));
 // English is unchanged.
 assert(P.applicationDate('closesOn','2026-11-30','Applications close on 30 November 2026.'));
 assert(!P.applicationDate('closesOn','2026-11-30','Project end date: 30 November 2026.'));
});
test('"due" wording is a deadline and never an opening',()=>{
 assert(P.applicationDate('closesOn','2027-01-04','Applications for the 2027-2028 fellowship year will be due Monday, January 4, 2027.'));
 assert(P.applicationDate('closesOn','2026-11-30','Due date: 30 November 2026'));
 assert(!P.applicationDate('opensOn','2027-01-04','Applications are due January 4, 2027.'));
 assert(!P.applicationDate('closesOn','2026-11-30','Payment due on 30 November 2026 for the conference hall.'));
});
