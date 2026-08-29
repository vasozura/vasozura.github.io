import type { Measure,NoteEvent,Timeline } from "./contracts";
export interface SchedulerFrame{position:number;duration:number;measure:Measure|null;beat:number;active:NoteEvent[];upcoming:NoteEvent[];reliable:boolean;}
export class CanonicalScheduler extends EventTarget{private raf=0;private playing=false;private position=0;private anchor=0;private anchoredAt=0;private tempo=.0+1;private loop:[number,number]|null=null;private lastFrame=0;constructor(readonly timeline:Timeline,private clock=()=>performance.now()) {super();}
 play(countInBeats=0){if(this.playing)return;this.playing=true;this.anchoredAt=this.clock();this.anchor=Math.max(0,this.position-countInBeats*60/(this.timeline.tempos[0]?.bpm??120));this.tick();}
 pause(){if(!this.playing)return;this.updatePosition();this.playing=false;cancelAnimationFrame(this.raf);this.emit();}
 stop(){this.pause();this.seek(0);}
 seek(seconds:number){this.position=Math.max(0,Math.min(seconds,this.timeline.durationSeconds));this.anchor=this.position;this.anchoredAt=this.clock();this.emit();}
 setTempo(percent:number){this.updatePosition();this.tempo=Math.max(.5,Math.min(1.5,percent/100));this.anchor=this.position;this.anchoredAt=this.clock();}
 setLoop(a:number|null,b:number|null){this.loop=a!==null&&b!==null&&b>a?[a,b]:null;}
 setMeasureLoop(a:number,b:number){const start=this.timeline.measures[a]?.startSeconds,end=this.timeline.measures[b];this.setLoop(start??null,end?end.startSeconds+end.durationSeconds:null);}
 snapshot():SchedulerFrame{const measure=this.timeline.measures.find(m=>this.position>=m.startSeconds&&this.position<m.startSeconds+m.durationSeconds)??null;const beat=measure?1+(this.position-measure.startSeconds)/(measure.durationSeconds/measure.beats):0;return{position:this.position,duration:this.timeline.durationSeconds,measure,beat,active:this.timeline.notes.filter(n=>n.startSeconds<=this.position&&n.startSeconds+n.durationSeconds>this.position),upcoming:this.timeline.notes.filter(n=>n.startSeconds>this.position&&n.startSeconds<=this.position+1),reliable:!this.lastFrame||this.clock()-this.lastFrame<250};}
 destroy(){this.pause();this.activeListenersCleanup();}
 private activeListenersCleanup(){/* EventTarget listeners become collectible with this instance. */}
 private updatePosition(){if(this.playing)this.position=this.anchor+(this.clock()-this.anchoredAt)/1000*this.tempo;if(this.loop&&this.position>=this.loop[1]){this.position=this.loop[0]+(this.position-this.loop[1]);this.anchor=this.position;this.anchoredAt=this.clock();}if(this.position>=this.timeline.durationSeconds){this.position=this.timeline.durationSeconds;this.playing=false;}}
 private tick=()=>{if(!this.playing)return;this.updatePosition();this.lastFrame=this.clock();this.emit();if(this.playing)this.raf=requestAnimationFrame(this.tick);};private emit(){this.dispatchEvent(new CustomEvent<SchedulerFrame>("frame",{detail:this.snapshot()}));}
}
