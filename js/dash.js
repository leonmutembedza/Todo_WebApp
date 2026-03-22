// ── Sparkline ─────────────────────────────────────────────────────────────────
class Spark {
  constructor(el, color, n=40) {
    this.el=el; this.color=color; this.n=n; this.data=[];
    this.ctx=el.getContext('2d');
    const ro=new ResizeObserver(()=>this._size()); ro.observe(el);
    this._size();
  }
  _size(){
    const r=this.el.getBoundingClientRect();
    this.el.width=r.width*devicePixelRatio; this.el.height=r.height*devicePixelRatio;
    this._draw();
  }
  push(v){ this.data.push(v); if(this.data.length>this.n)this.data.shift(); this._draw(); }
  _draw(){
    const {ctx,data,color,el}=this;
    const W=el.width,H=el.height;
    ctx.clearRect(0,0,W,H);
    if(data.length<2)return;
    const mn=Math.min(...data),mx=Math.max(...data),rng=mx-mn||1;
    const xs=W/(data.length-1);
    const pts=data.map((v,i)=>({x:i*xs, y:H-((v-mn)/rng)*H*.78-H*.1}));
    // fill
    const g=ctx.createLinearGradient(0,0,0,H);
    g.addColorStop(0,color+'30'); g.addColorStop(1,color+'00');
    ctx.beginPath(); ctx.moveTo(pts[0].x,H);
    pts.forEach(p=>ctx.lineTo(p.x,p.y));
    ctx.lineTo(pts[pts.length-1].x,H); ctx.closePath();
    ctx.fillStyle=g; ctx.fill();
    // line
    ctx.beginPath(); pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
    ctx.strokeStyle=color; ctx.lineWidth=2*devicePixelRatio; ctx.lineJoin='round'; ctx.stroke();
  }
}

const sIR  = new Spark(document.getElementById('c-ir'),  '#9333ea');
const sAC  = new Spark(document.getElementById('c-ac'),  '#2563eb');
const sVib = new Spark(document.getElementById('c-vib'), '#f97316');

// seed charts with realistic-looking data
for(let i=0;i<35;i++){
  sIR.push(55+Math.sin(i*.3)*10+Math.random()*3);
  sAC.push(72+Math.sin(i*.25)*7+Math.random()*2);
  sVib.push(2.2+Math.sin(i*.4)*.45+Math.random()*.18);
}

// ── Clock ─────────────────────────────────────────────────────────────────────
function tick(){
  const n=new Date(),h=n.getHours()%12||12,m=String(n.getMinutes()).padStart(2,'0'),
        s=String(n.getSeconds()).padStart(2,'0'),ap=n.getHours()>=12?'PM':'AM';
  document.getElementById('clock').textContent=`${h}:${m}:${s} ${ap}`;
}
tick(); setInterval(tick,1000);

// ── Uptime ────────────────────────────────────────────────────────────────────
const t0=Date.now();
setInterval(()=>{
  const s=Math.floor((Date.now()-t0)/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60);
  document.getElementById('ic-up').textContent=h?`${h}h ${m}m`:`${m}m`;
},10000);

// ── Simulated sensors ─────────────────────────────────────────────────────────
let dp=18432;
setInterval(()=>{
  const ir= +(55+Math.sin(Date.now()*.001)*12+Math.random()*3).toFixed(2);
  const ac= +(72+Math.sin(Date.now()*.0008)*9+Math.random()*2).toFixed(2);
  const vib=+(2.2+Math.sin(Date.now()*.0012)*.5+Math.random()*.15).toFixed(2);
  document.getElementById('v-ir').innerHTML=`${ir}<span>%</span>`;
  document.getElementById('v-ac').innerHTML=`${ac}<span>dB</span>`;
  document.getElementById('v-vib').innerHTML=`${vib}<span>g</span>`;
  sIR.push(ir); sAC.push(ac); sVib.push(vib);
  dp+=Math.floor(Math.random()*3+1);
  document.getElementById('ic-dp').textContent=dp.toLocaleString();
},1200);

// ── Detection colours ─────────────────────────────────────────────────────────
const PAL=['#9333ea','#2563eb','#f97316','#ef4444','#22c55e','#f7c948','#06d6a0','#4cc9f0','#e63946','#c77dff'];
const col=c=>PAL[c%PAL.length];

// ── Camera / WS ───────────────────────────────────────────────────────────────
const video=document.getElementById('video');
const canvas=document.getElementById('canvas');
const ctx=canvas.getContext('2d');
const off=document.createElement('canvas');
const offC=off.getContext('2d');
const SW=640, SFPS=15;
let ws=null,stream=null,running=false,facingMode='environment';
let sendTs=0,lastSend=0,fc=0,lastFT=performance.now();

function setConn(s){
  const d=document.getElementById('conn-dot'),t=document.getElementById('conn-text');
  if(s==='live'){d.style.background='#22c55e';t.textContent='Connected';}
  else if(s==='off'){d.style.background='#94a3b8';t.textContent='Offline';}
  else{d.style.background='#f97316';t.textContent='Connecting…';}
}

async function startCam(){
  if(stream)stream.getTracks().forEach(t=>t.stop());
  stream=await navigator.mediaDevices.getUserMedia({video:{facingMode,width:{ideal:1280},height:{ideal:720}},audio:false});
  video.srcObject=stream; await video.play();
  const h=video.videoHeight;
  document.getElementById('s-qual').textContent=h>=1080?'1080p':h>=720?'720p':h>=480?'480p':h+'p';
}

function openWS(){
  const url=document.getElementById('ws-url').value.trim();
  setConn('connecting');
  ws=new WebSocket(url); ws.binaryType='arraybuffer';
  ws.onopen=()=>{setConn('live');loop();};
  ws.onmessage=onMsg;
  ws.onclose=()=>{if(running)setConn('off');};
  ws.onerror=()=>setConn('off');
}

function onMsg(ev){
  const lat=Math.round(performance.now()-sendTs);
  document.getElementById('s-lat').textContent=lat+' ms';
  let d; try{d=JSON.parse(ev.data);}catch{return;}
  drawDets(d.detections||[],d.width,d.height);
  renderChips(d.detections||[]);
}

function loop(){
  if(!running)return;
  const now=performance.now();
  fc++;
  if(now-lastFT>=1000){
    const fps=Math.round(fc*1000/(now-lastFT));
    document.getElementById('s-fps').textContent=fps;
    document.getElementById('cam-lbl').textContent=`Arduino CAM — ${fps} FPS`;
    fc=0; lastFT=now;
  }
  if(now-lastSend>=1000/SFPS){sendFrame();lastSend=now;}
  requestAnimationFrame(loop);
}

function sendFrame(){
  if(!ws||ws.readyState!==1)return;
  if(video.readyState<2)return;
  const vw=video.videoWidth,vh=video.videoHeight;
  if(!vw||!vh)return;
  off.width=SW; off.height=Math.round(SW*vh/vw);
  offC.drawImage(video,0,0,off.width,off.height);
  off.toBlob(b=>{
    if(!b)return;
    b.arrayBuffer().then(buf=>{
      if(ws.readyState===1){sendTs=performance.now();ws.send(buf);}
    });
  },'image/jpeg',.78);
}

function drawDets(dets,srcW,srcH){
  const r=video.getBoundingClientRect();
  canvas.width=r.width; canvas.height=r.height;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if(!srcW||!srcH||!dets.length)return;
  const va=srcW/srcH,da=r.width/r.height;
  let sx,sy,ox=0,oy=0;
  if(va>da){sy=r.height/srcH;sx=sy;ox=(r.width-srcW*sx)/2;}
  else{sx=r.width/srcW;sy=sx;oy=(r.height-srcH*sy)/2;}
  ctx.lineWidth=2;
  ctx.font='600 12px "DM Mono",monospace';
  for(const d of dets){
    const c=col(d.cls);
    const x1=d.x1*sx+ox,y1=d.y1*sy+oy,w=(d.x2-d.x1)*sx,h=(d.y2-d.y1)*sy;
    ctx.fillStyle=c+'18'; ctx.fillRect(x1,y1,w,h);
    ctx.shadowColor=c; ctx.shadowBlur=6;
    ctx.strokeStyle=c; ctx.strokeRect(x1,y1,w,h); ctx.shadowBlur=0;
    const lbl=`${d.label} ${Math.round(d.conf*100)}%`;
    const tw=ctx.measureText(lbl).width+10;
    const ly=y1>=19?y1-19:y1+2;
    ctx.fillStyle=c; ctx.fillRect(x1,ly,tw,17);
    ctx.fillStyle='#fff'; ctx.fillText(lbl,x1+5,ly+12);
  }
}

function renderChips(dets){
  const o=document.getElementById('det-overlay');
  const cnt={};
  dets.forEach(d=>cnt[d.label]=(cnt[d.label]||0)+1);
  o.innerHTML='';
  for(const[lbl,n]of Object.entries(cnt)){
    const cls=dets.find(d=>d.label===lbl)?.cls??0;
    const c=col(cls);
    const chip=document.createElement('div');
    chip.className='det-chip';
    chip.style.color=c; chip.style.borderColor=c;
    chip.textContent=n>1?`${lbl} ×${n}`:lbl;
    o.appendChild(chip);
  }
}

// buttons
document.getElementById('btn-start').addEventListener('click',async()=>{
  document.getElementById('btn-start').disabled=true;
  document.getElementById('btn-stop').disabled=false;
  running=true;
  try{await startCam();openWS();}
  catch(e){
    alert('Camera error: '+e.message);
    running=false;
    document.getElementById('btn-start').disabled=false;
    document.getElementById('btn-stop').disabled=true;
    setConn('off');
  }
});
document.getElementById('btn-stop').addEventListener('click',()=>{
  running=false;
  if(ws){ws.close();ws=null;}
  if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
  ctx.clearRect(0,0,canvas.width,canvas.height);
  document.getElementById('det-overlay').innerHTML='';
  document.getElementById('s-fps').textContent='--';
  document.getElementById('s-lat').textContent='-- ms';
  setConn('off');
  document.getElementById('btn-start').disabled=false;
  document.getElementById('btn-stop').disabled=true;
});
document.getElementById('btn-flip').addEventListener('click',async()=>{
  facingMode=facingMode==='environment'?'user':'environment';
  if(stream)await startCam();
});
window.addEventListener('resize',()=>{
  if(running){const r=video.getBoundingClientRect();canvas.width=r.width;canvas.height=r.height;}
});