import {createHash} from 'node:crypto';
import {NintendoDSRom} from '../../vendor/pokeweb-serverless/src/nds/rom';
import {NARC} from '../../vendor/pokeweb-serverless/src/nds/narc';
import {decodeGen5TextBank,encodeGen5TextBank} from '../../vendor/pokeweb-serverless/src/pokeweb/text';
import {parseBw2DialogueFont,layoutBw2Dialogue,DIALOGUE_LINE_WIDTH,type DialogueFont,type DialogueVariables} from '../../vendor/pokeweb-serverless/src/pokeweb/bw2DialoguePreview';
import {decompressNitro} from '../../vendor/pokeweb-serverless/src/pokeweb/pokemonSpriteModel';
import type {ApprovedTextChange} from '../dialogue-guard';
const hash=(text:string|Uint8Array)=>createHash('sha256').update(text).digest('hex');
export type TextApproval=ApprovedTextChange&{archive:'messages'|'story'};
// Authored text currently uses only the player-name word buffer. Explicit bounds
// are mandatory for any other future variable, rather than guessing its length.
export const AUTHORED_DIALOGUE_VARIABLES:DialogueVariables={0:{length:7,label:'English player name'}};
export function readDialogueFont(rom:NintendoDSRom):DialogueFont{
 const bytes=new NARC(rom.getFileByName('a/0/2/3')).files[0];
 return parseBw2DialogueFont([0x10,0x11,0x30].includes(bytes[0])?decompressNitro(bytes):bytes);
}
function width(text:string,font:DialogueFont,variables:DialogueVariables){
 const result=layoutBw2Dialogue(text,font,variables);
 for(const variable of result.variables)if(!variables[variable.slot])throw new Error(`Unbounded authored dialogue variable ${variable.slot}`);
 const unsupported=result.warnings.filter(w=>!w.includes('exceeds')&&!w.includes('below the two-line'));
 if(unsupported.length)throw new Error(`Unsupported authored dialogue: ${unsupported.join('; ')}`);
 return Math.max(0,...result.pages.flatMap(p=>p.widths));
}
/** Format only authored dialogue; never use this on arbitrary original strings. */
export function formatAuthoredDialogue(text:string,font:DialogueFont,variables:DialogueVariables=AUTHORED_DIALOGUE_VARIABLES){
 const initial=layoutBw2Dialogue(text,font,variables);
 if(!initial.warnings.length&&!initial.variables.some(v=>!variables[v.slot]))return text;
 // Existing explicit clear-page boundaries remain paragraph boundaries. Within
 // each paragraph, reflow words and replace scrolls/newlines with measured rows.
 const paragraphs=text.replace(/\r\n?/g,'\\r').split(/\\r(?:\\n)?/).map(p=>p.replace(/\\[nf]|\n/g,' ').trim()).filter(Boolean);
 const pages:string[]=[];
 for(const paragraph of paragraphs){
  const words=paragraph.match(/(?:VAR\([^)]*\)|\\x[\da-fA-F]{4}|[^\s])+/g)??[];
  const rows:string[]=[];let line='';
  for(const word of words){
   const wordWidth=width(word,font,variables);
   if(wordWidth>DIALOGUE_LINE_WIDTH)throw new Error(`Authored dialogue word exceeds the native width: ${word}`);
   const next=line?line+' '+word:word;
   if(line&&width(next,font,variables)>DIALOGUE_LINE_WIDTH){rows.push(line);line=word;}else line=next;
  }
  if(line)rows.push(line);
  for(let i=0;i<rows.length;i+=2)pages.push(rows.slice(i,i+2).join('\\n'));
 }
 const formatted=pages.join('\\r\\n'),result=layoutBw2Dialogue(formatted,font,variables);
 if(result.warnings.length)throw new Error(`Authored dialogue layout failed: ${result.warnings.join('; ')}`);
 return formatted;
}

/** Final assembly pass, before the independent original-dialogue preservation
 * guard. Original entries are considered only when their exact existing approval
 * matches BOTH hashes. Unapproved edits remain visible to the guard. */
export function formatAddedDialogue(rom:NintendoDSRom,beforeText:Map<string,Uint8Array>,approvals:TextApproval[]){
 const font=readDialogueFont(rom),changes:Array<{archive:string;bank:number;entry:string;pages:number;beforeSha256:string;afterSha256:string;approvedRewrite:boolean}>=[];
 const staged:Array<{path:string;fileId:number;bytes:Uint8Array;beforeSha256:string}>=[];
 const updatedApprovals=approvals.map(a=>({...a}));let checked=0;
 for(const [archive,path]of[['story','a/0/0/3'],['messages','a/0/0/2']]as const){
  const original=new NARC(beforeText.get(archive)!),current=new NARC(new Uint8Array(rom.getFileByName(path)));let archiveChanged=false;
  for(let bank=0;bank<current.files.length;bank++){
   if(archive==='messages'&&bank!==381)continue;
   const base=new Map(original.files[bank]?decodeGen5TextBank(original.files[bank]).map(e=>[e[0],e[1]]):[]),entries=decodeGen5TextBank(current.files[bank]);let changed=false;
   for(const entry of entries){
    const old=base.get(entry[0]);
    const approval=updatedApprovals.find(a=>a.archive===archive&&a.bank===bank&&a.entry===entry[0]);
    const approved=old!==undefined&&approval&&approval.before_sha256===hash(old)&&approval.after_sha256===hash(entry[1]);
    if(old!==undefined&&!approved)continue;
    checked++;
    const text=formatAuthoredDialogue(entry[1],font);
    if(text===entry[1])continue;
    changes.push({archive,bank,entry:entry[0],pages:layoutBw2Dialogue(text,font,AUTHORED_DIALOGUE_VARIABLES).pages.length,beforeSha256:hash(entry[1]),afterSha256:hash(text),approvedRewrite:!!approved});
    entry[1]=text;changed=true;
    if(approved)approval!.after_sha256=hash(text);
   }
   if(changed){current.files[bank]=encodeGen5TextBank(entries);archiveChanged=true;}
  }
  if(archiveChanged)staged.push({path,fileId:rom.fileId(path),bytes:new Uint8Array(current.save()),beforeSha256:hash(rom.getFileByName(path))});
 }
 for(const file of staged)rom.files[file.fileId]=file.bytes;
 return{checked,changes,approvedDialogueChanges:updatedApprovals,changedFiles:staged.map(({bytes,...f})=>({...f,bytes:bytes.length,afterSha256:hash(bytes)})),nativeLineWidth:DIALOGUE_LINE_WIDTH,originalUnapprovedEntriesTouched:0};
}
