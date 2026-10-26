'use strict';
// Select literal source spans. Omission markers must never split adjacent lines.
const LIMIT=3400;
const normal=s=>String(s??'').normalize('NFC').replace(/\s+/g,' ').trim();
const fold=s=>normal(s).toLowerCase();
const strong=/appl(?:ication|ications|y)|proposals?|invit(?:e|es|ation)|submi(?:t|ssion)|deadline|closing|last date|आवेदन|अंतिम/i;
const date=/\b20\d{2}-\d{2}-\d{2}\b|\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i;
function merged(ranges,text){
 const sorted=ranges.map(r=>({...r})).sort((a,b)=>a.start-b.start||a.end-b.end),out=[];
 for(const r of sorted){const last=out[out.length-1];if(last&&(r.start<=last.end||!text.slice(last.end,r.start).trim()))last.end=Math.max(last.end,r.end);else out.push(r)}return out;
}
function render(ranges,text){
 const spans=merged(ranges,text);if(!spans.length)return '';
 return (text.slice(0,spans[0].start).trim()?'[omitted content]\n':'')+spans.map(r=>text.slice(r.start,r.end)).join('\n[omitted content]\n')+(text.slice(spans[spans.length-1].end).trim()?'\n[omitted content]':'');
}
function packPage(row){
 const text=String(row.text??''),title=String(row.title??'').slice(0,500);
 if(text.length<=LIMIT)return {title,url:row.url,text,truncated:Boolean(row.truncated)};
 const lines=[];
 for(const m of text.matchAll(/[^\r\n]+/g)){const trimmed=m[0].trim();if(!trimmed)continue;const start=m.index+m[0].indexOf(trimmed);lines.push({start,end:start+trimmed.length,text:trimmed})}
 const counts=new Map();for(const line of lines)if(line.text.length<80)counts.set(fold(line.text),(counts.get(fold(line.text))??0)+1);
 // A long country/discipline selector is form chrome, not the main article.
 const form=new Set();
 for(let i=0;i<lines.length;i++)if(/^(?:select country|country\*?)$/i.test(lines[i].text)&&lines.slice(i+1,i+5).some(l=>/^Afghanistan$/i.test(l.text))){
  for(let n=i;n<lines.length;n++){if(n>i+5&&(/^(?:company|discipline|by submitting|submit|about)$/i.test(lines[n].text)||lines[n].text.length>100))break;form.add(n)}
 }
 let slug=[];try{slug=decodeURIComponent(new URL(row.url).pathname.split('/').filter(Boolean).pop()??'').replace(/\.[a-z]{2,5}$/i,'').split(/[-_]+/).filter(s=>s.length>1)}catch{}
 const exactHeading=fold(title);let anchor=-1,best=0;
 for(let i=0;i<lines.length;i++){
  const line=lines[i];if(form.has(i)||line.text.length>500)continue;
  // A URL containing the route slug is a link, not evidence of a heading.
  const visible=line.text.replace(/\[https?:\/\/[^\]]+\]|https?:\/\/\S+/gi,'').trim();
  let score=exactHeading.length>8&&fold(visible)===exactHeading?100:0;
  if(slug.length>=2&&slug.length<=30){const words=new Set(fold(visible).match(/[\p{L}\p{N}]+/gu)??[]);const hits=slug.filter(s=>words.has(s.toLowerCase())).length;if(hits===slug.length&&words.size<=slug.length+5)score=Math.max(score,80)}
  // Later headings beat their earlier menu entries, but not footer links.
  if(score&&i>lines.length*.85)score-=60;
  if(score>best||(score===best&&score>60)){best=score;anchor=i}
 }
 // Directory profiles may abbreviate names or have a misspelled URL slug.
 if(/\/(?:people-profile|person|team)\//i.test(String(row.url??''))){const people=lines.findIndex(l=>/^People$/i.test(l.text));if(people>=0&&lines[people+1]?.text.length<=120){anchor=people+1;best=100}}
 const mainLocated=best>=60;
 if(anchor<0)anchor=lines.findIndex((l,i)=>!form.has(i)&&l.text.length>=100&&!(counts.get(fold(l.text))>1));
 if(anchor<0)anchor=0;
 const selected=[];
 function add(range){if(range.end<=range.start)return false;const next=merged([...selected,range],text);if(render(next,text).length>LIMIT)return false;selected.splice(0,selected.length,...next);return true}
 function bounded(start,end,max=900){
  if(end-start<=max)return {start,end};let stop=start+max;const space=text.lastIndexOf(' ',stop);if(space>start+max-100)stop=space;return {start,end:stop};
 }
 // Retain the main heading/identity and its opening paragraph before keywords.
 if(lines[anchor]){
  let end=lines[anchor].end;
  for(let n=anchor+1;n<lines.length&&!form.has(n);n++){if(lines[n].start-lines[anchor].start>900)break;end=lines[n].end;if(lines[n].text.length>=180)break}
  add(bounded(lines[anchor].start,end));
 }
 const windows=[];
 for(let i=0;i<lines.length;i++){
  if(form.has(i)||(mainLocated&&i<anchor))continue;const line=lines[i],repeated=line.text.length<80&&(counts.get(fold(line.text))??0)>1;
  if(/newsletter|cookies?|privacy|subscribe|by submitting your information|©/i.test(line.text)&&!/proposal|grant application/i.test(line.text))continue;
  const facts=strong.test(line.text),hasDate=date.test(line.text);
  let score=(facts?8:0)+(hasDate?8:0)+(/grant|funding|fellow|scholar|अनुदान/i.test(line.text)&&line.text.length>=65?2:0)+(i>=anchor&&i<anchor+15?2:0);
  if(repeated&&!hasDate&&line.text.length<65)score-=12;
  if(score<=0)continue;
  if(line.text.length>900){
   const starts=new Set([line.start]);for(const match of line.text.matchAll(/appl\w*|proposal\w*|deadline|closing|invitat\w*|आवेदन|अंतिम/gi))starts.add(Math.max(line.start,line.start+match.index-120));
   for(const start of starts){const r=bounded(start,line.end,850);windows.push({...r,score:score+(strong.test(text.slice(r.start,r.end))?2:0)})}
  }else{
   // Include nearby short labels/values as a single contiguous source section.
   let first=i,last=i;
   for(let n=0;n<2&&first>0&&!form.has(first-1)&&lines[first-1].text.length<160;n++)first--;
   for(let n=0;n<2&&last+1<lines.length&&!form.has(last+1)&&lines[last+1].text.length<240;n++)last++;
   windows.push({...bounded(lines[first].start,lines[last].end,1000),score});
  }
 }
 windows.sort((a,b)=>b.score-a.score||a.start-b.start);
 for(const window of windows)add(window);
 const packed=render(selected,text)||text.slice(0,LIMIT-20)+'\n[omitted content]';
 return {title,url:row.url,text:packed,truncated:true};
}
module.exports={packPage};
