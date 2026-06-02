const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;

let coins = 0;
const coinCountEl = document.getElementById('coinCount');
const btnMissile = document.getElementById('btnMissile');
const btnNet = document.getElementById('btnNet');

const fishes = [];
const projectiles = [];
const nets = [];
const floatTexts = [];

// sprite + audio setup
const spriteImage = new Image();
let spriteLoaded = false;
spriteImage.src = 'assets/fish_sprites.svg';
spriteImage.onload = () => { spriteLoaded = true; };

// speeds are in pixels/second
const fishTypes = [
  {name:'小鱼', color:'#66c2a5', radius:14, value:5, speed:80, frame:0},
  {name:'中鱼', color:'#ffd166', radius:22, value:15, speed:60, frame:1},
  {name:'大鱼', color:'#f06b6b', radius:32, value:50, speed:40, frame:2},
  {name:'稀有鱼', color:'#c27bff', radius:40, value:200, speed:32, frame:3}
];

// simple WebAudio synth for effects
const AudioCtx = window.AudioContext || window.webkitAudioContext;
const audioCtx = AudioCtx ? new AudioCtx() : null;
function playSound(name){
  if(!audioCtx) return;
  const now = audioCtx.currentTime;
  if(name==='fire'){
    const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
    o.type='square'; o.frequency.setValueAtTime(600, now);
    g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(0.12, now+0.01);
    g.gain.exponentialRampToValueAtTime(0.001, now+0.4);
    o.connect(g); g.connect(audioCtx.destination); o.start(now); o.stop(now+0.45);
  }else if(name==='net'){
    const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
    o.type='sine'; o.frequency.setValueAtTime(260, now);
    g.gain.setValueAtTime(0.0, now); g.gain.linearRampToValueAtTime(0.08, now+0.02);
    g.gain.exponentialRampToValueAtTime(0.001, now+0.6);
    o.connect(g); g.connect(audioCtx.destination); o.start(now); o.stop(now+0.6);
  }else if(name==='coin'){
    const o1 = audioCtx.createOscillator(), g1 = audioCtx.createGain();
    o1.type='triangle'; o1.frequency.setValueAtTime(1200, now);
    g1.gain.setValueAtTime(0.001, now); g1.gain.linearRampToValueAtTime(0.12, now+0.01);
    g1.gain.exponentialRampToValueAtTime(0.001, now+0.18);
    o1.connect(g1); g1.connect(audioCtx.destination); o1.start(now); o1.stop(now+0.18);
  }else if(name==='hit'){
    const o = audioCtx.createOscillator(), g=audioCtx.createGain();
    o.type='sawtooth'; o.frequency.setValueAtTime(320, now);
    g.gain.setValueAtTime(0.001, now); g.gain.linearRampToValueAtTime(0.14, now+0.01);
    g.gain.exponentialRampToValueAtTime(0.001, now+0.25);
    o.connect(g); g.connect(audioCtx.destination); o.start(now); o.stop(now+0.25);
  }
}

// weapon state: ammo and cooldown
let missileAmmo = 10;
let netAmmo = 3;
const missileMaxAmmo = 10;
const netMaxAmmo = 3;
const missileCooldown = 0.5; // seconds
const netCooldown = 2.5; // seconds
let missileLastFire = -9999;
let netLastFire = -9999;

const missileAmmoEl = document.getElementById('missileAmmo');
const netAmmoEl = document.getElementById('netAmmo');
const baitCountEl = document.getElementById('baitCount');
const btnBait = document.getElementById('btnBait');
const btnShop = document.getElementById('btnShop');
const shopModal = document.getElementById('shopModal');
const shopClose = document.getElementById('shopClose');
const missileModeSelect = document.getElementById('missileMode');

// mouse tracking for cannon
let mouseX = W/2, mouseY = H/2;
let netActivated = false; // whether net throwing mode is active

// upgrades state (persisted)
const defaultUpgrades = { penetration: false, explosive: false, netLevel: 0, baitCount: 0 };
let upgrades = loadUpgrades();

function loadUpgrades(){
  try{ const raw = localStorage.getItem('bp_upgrades'); if(raw) return JSON.parse(raw); }catch(e){}
  localStorage.setItem('bp_upgrades', JSON.stringify(defaultUpgrades));
  return Object.assign({}, defaultUpgrades);
}
function saveUpgrades(){ localStorage.setItem('bp_upgrades', JSON.stringify(upgrades)); }

function applyUpgradesToUI(){
  // enable mode options if purchased
  missileModeSelect.querySelector('option[value="penetration"]').disabled = !upgrades.penetration;
  missileModeSelect.querySelector('option[value="explosive"]').disabled = !upgrades.explosive;
  baitCountEl.textContent = upgrades.baitCount || 0;
}
applyUpgradesToUI();

function canFireMissile(){
  const t = performance.now()/1000;
  return (t - missileLastFire) >= missileCooldown && missileAmmo > 0;
}
function canThrowNet(){
  const t = performance.now()/1000;
  return (t - netLastFire) >= netCooldown && netAmmo > 0;
}

// passive reload: small regen over time
setInterval(()=>{
  if(missileAmmo < missileMaxAmmo) missileAmmo++;
  if(netAmmo < netMaxAmmo) netAmmo++; // slower but simple
}, 4000);


function rand(min,max){ return Math.random()*(max-min)+min }

class Fish{
  constructor(type){
    this.type = type;
    this.r = type.radius;
    this.x = Math.random()>0.5 ? -this.r : W + this.r;
    this.y = rand(60, H-120);
    // velocity in pixels/second
    this.vx = (this.x<0 ? 1 : -1) * (type.speed + Math.random()*20);
    this.baseY = this.y;
    this.phase = Math.random()*Math.PI*2;
    this.wobbleFreq = rand(0.8,1.6);
    this.wobbleAmp = 6 + this.r*0.25;
  }
  update(dt){
    this.x += this.vx * dt;
    const t = performance.now()/1000;
    this.y = this.baseY + Math.sin(t * this.wobbleFreq + this.phase) * this.wobbleAmp;
    if(this.x < -120 || this.x > W+120){ this.dead = true }
  }
  draw(ctx){
    if(spriteLoaded){
      // sprite sheet: 4 frames horizontally, each 160x160
      const frameW = 160, frameH = 160;
      const sx = this.type.frame * frameW;
      const sy = 0;
      const dw = this.r*2.4, dh = this.r*1.8;
      ctx.save();
      ctx.translate(this.x,this.y);
      if(this.vx>0) ctx.scale(1,1); else ctx.scale(-1,1);
      ctx.drawImage(spriteImage, sx, sy, frameW, frameH, -dw/2, -dh/2, dw, dh);
      ctx.restore();
    }else{
      ctx.save();
      ctx.translate(this.x,this.y);
      if(this.vx>0) ctx.scale(1,1); else ctx.scale(-1,1);
      // body
      ctx.fillStyle = this.type.color;
      ctx.beginPath();
      ctx.ellipse(0,0,this.r,this.r*0.7,0,0,Math.PI*2);
      ctx.fill();
      // tail
      ctx.fillStyle = shade(this.type.color, -20);
      ctx.beginPath();
      ctx.moveTo(-this.r,0);
      ctx.lineTo(-this.r-14,-10);
      ctx.lineTo(-this.r-14,10);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}

class Projectile{
  constructor(x,y,tx,ty){
    this.x=x;this.y=y; this.speed=600; this.r=6; this.dead=false;
    const dx=tx-x, dy=ty-y; const d=Math.hypot(dx,dy);
    this.vx=dx/d*this.speed; this.vy=dy/d*this.speed;
    this.angle = Math.atan2(this.vy, this.vx);
  }
  update(dt){ this.x += this.vx*dt; this.y += this.vy*dt; if(this.x<0||this.x>W||this.y<0||this.y>H) this.dead=true }
  draw(ctx){
    // draw a rotated projectile (triangle/rocket) pointing along velocity
    ctx.save();
    ctx.translate(this.x,this.y);
    ctx.rotate(this.angle);
    // body
    ctx.fillStyle='#ffdd57';
    ctx.beginPath();
    ctx.moveTo(-this.r, -this.r/2);
    ctx.lineTo(this.r*1.6, 0);
    ctx.lineTo(-this.r, this.r/2);
    ctx.closePath();
    ctx.fill();
    // nose highlight
    ctx.fillStyle='rgba(255,255,255,0.6)';
    ctx.beginPath(); ctx.arc(this.r*0.8,0,this.r/3,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }
}

class Net{
  constructor(x,y){ this.x=x; this.y=y; this.r=0; this.maxR=120 + (upgrades.netLevel||0)*60; this.grow=400; this.dead=false }
  update(dt){ this.r += this.grow*dt; if(this.r>this.maxR){ this.dead=true } }
  draw(ctx){
    // spider web style with radial lines and concentric circles
    ctx.save();
    ctx.strokeStyle='rgba(180,230,255,0.8)';
    ctx.lineWidth=2;
    // draw radial lines (like spider web threads)
    for(let i=0;i<16;i++){
      const angle = (Math.PI*2*i)/16;
      const endX = this.x + Math.cos(angle)*this.r;
      const endY = this.y + Math.sin(angle)*this.r;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    }
    // draw concentric circles
    ctx.lineWidth=1.5;
    ctx.strokeStyle='rgba(180,230,255,0.6)';
    for(let circle=0.2;circle<=1;circle+=0.2){
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r*circle, 0, Math.PI*2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

class Particle{
  constructor(x,y,vx,vy,life,color){
    this.x=x; this.y=y; this.vx=vx; this.vy=vy;
    this.life=life; this.maxLife=life;
    this.color=color; this.r=3+Math.random()*3;
    this.gravity=80;
  }
  update(dt){
    this.x += this.vx*dt; this.y += this.vy*dt;
    this.vy += this.gravity*dt;
    this.life -= dt;
  }
  draw(ctx){
    const alpha = Math.max(0, this.life/this.maxLife);
    ctx.fillStyle = this.color.replace(')', `,${alpha})`);
    ctx.beginPath();
    ctx.arc(this.x,this.y,this.r,0,Math.PI*2);
    ctx.fill();
  }
}

class Explosion{
  constructor(x,y){
    this.x=x; this.y=y; this.r=0; this.maxR=120; this.grow=800; this.dead=false;
    this.particles = [];
    // spawn particles
    for(let i=0;i<16;i++){
      const angle = (Math.PI*2*i)/16;
      const speed = 150+Math.random()*200;
      const vx = Math.cos(angle)*speed;
      const vy = Math.sin(angle)*speed;
      const colors = ['rgba(255,180,40', 'rgba(255,100,20', 'rgba(200,80,0'];
      const color = colors[Math.floor(Math.random()*colors.length)];
      this.particles.push(new Particle(x,y,vx,vy,0.8,color));
    }
  }
  update(dt){
    this.r += this.grow*dt;
    if(this.r>this.maxR) this.dead=true;
    this.particles.forEach(p=>p.update(dt));
    this.particles = this.particles.filter(p=>p.life>0);
  }
  draw(ctx){
    // core explosion glow
    const alpha = Math.max(0, 1 - (this.r/this.maxR));
    ctx.fillStyle=`rgba(255,160,40,${alpha*0.15})`;
    ctx.beginPath();
    ctx.arc(this.x,this.y,this.r,0,Math.PI*2);
    ctx.fill();
    ctx.strokeStyle=`rgba(255,140,20,${alpha*0.4})`;
    ctx.lineWidth=2;
    ctx.beginPath();
    ctx.arc(this.x,this.y,this.r,0,Math.PI*2);
    ctx.stroke();
    // particles
    this.particles.forEach(p=>p.draw(ctx));
  }
}

const explosions = [];
const particles = [];

function shade(color, percent){ // simple hex shade
  const num = parseInt(color.slice(1),16);
  let r = (num>>16) + Math.round(255*percent/100);
  let g = (num>>8 & 0x00FF) + Math.round(255*percent/100);
  let b = (num & 0x0000FF) + Math.round(255*percent/100);
  r=Math.max(0,Math.min(255,r)); g=Math.max(0,Math.min(255,g)); b=Math.max(0,Math.min(255,b));
  return '#'+(r<<16 | g<<8 | b).toString(16).padStart(6,'0');
}

function spawnFish(){ const t = fishTypes[Math.floor(Math.random()*fishTypes.length)]; fishes.push(new Fish(t)) }
setInterval(spawnFish, 900);
for(let i=0;i<6;i++) spawnFish();

let last=performance.now();
function loop(now){
  const dt = Math.min(40,(now-last))/1000; last=now;
  update(dt); draw(); requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function update(dt){
  fishes.forEach(f=>f.update(dt)); fishes.filter(f=>f.dead).forEach(f=>{ fishes.splice(fishes.indexOf(f),1) });
  projectiles.forEach(p=>p.update(dt)); projectiles.filter(p=>p.dead).forEach(p=>projectiles.splice(projectiles.indexOf(p),1));
  nets.forEach(n=>n.update(dt)); nets.filter(n=>n.dead).forEach(n=>nets.splice(nets.indexOf(n),1));

  // collisions: projectile vs fish
  projectiles.forEach(p=>{
    fishes.slice().forEach(f=>{
      const d = Math.hypot(p.x-f.x, p.y-f.y);
      if(d < p.r + f.r){
        // hit
        if(p.explosive){
          // create explosion at hit
          explosions.push(new Explosion(p.x,p.y));
          playSound('hit');
          p.dead = true;
        }else if(p.penetrationRemaining && p.penetrationRemaining>0){
          // penetrate: reduce count, do not kill projectile until exhausted
          p.penetrationRemaining--;
          f.dead = true; collectFish(f);
          playSound('hit');
          if(p.penetrationRemaining<=0) p.dead = true;
        }else{
          // normal projectile
          p.dead=true; f.dead=true; collectFish(f); playSound('hit');
        }
      }
    })
  });
  // nets: area capture
  nets.forEach(n=>{
    fishes.slice().forEach(f=>{
      const d = Math.hypot(n.x-f.x, n.y-f.y);
      if(d < n.r){ f.dead=true; collectFish(f) }
    })
  });

  // explosions: area damage
  explosions.forEach(ex=>{
    fishes.slice().forEach(f=>{
      const d = Math.hypot(ex.x-f.x, ex.y-f.y);
      if(d < ex.r && !f.dead){ f.dead = true; collectFish(f); }
    })
  });

  // update explosions and remove dead
  explosions.forEach(ex=>ex.update(dt)); explosions.filter(e=>e.dead).forEach(e=>explosions.splice(explosions.indexOf(e),1));

  // process bait attraction
  processBait(dt);

  // float texts
  floatTexts.forEach(t=>{ t.y -= 40*dt; t.life -= dt; });
  for(let i=floatTexts.length-1;i>=0;i--) if(floatTexts[i].life<=0) floatTexts.splice(i,1);
  // update weapon HUD each tick
  updateWeaponHUD();
}

function draw(){ 
  ctx.clearRect(0,0,W,H);
  
  // background gradient with depth effect
  const bgGrad = ctx.createLinearGradient(0,0,0,H);
  bgGrad.addColorStop(0, '#1a4d68');
  bgGrad.addColorStop(0.3, '#0d3b66');
  bgGrad.addColorStop(0.7, '#0a2342');
  bgGrad.addColorStop(1, '#051e3e');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0,0,W,H);
  
  // underwater particles (slow floating objects)
  ctx.fillStyle = 'rgba(100,200,255,0.03)';
  for(let i=0;i<3;i++){
    const x = (performance.now()/50 + i*200) % W;
    const y = H - 60 - Math.sin(performance.now()/3000 + i)*40;
    ctx.beginPath();
    ctx.arc(x, y, 2+i, 0, Math.PI*2);
    ctx.fill();
  }
  
  // seabed
  ctx.fillStyle = 'rgba(10,30,50,0.4)';
  ctx.fillRect(0, H-40, W, 40);
  ctx.strokeStyle = 'rgba(100,150,180,0.15)';
  ctx.lineWidth = 1;
  for(let i=0;i<W;i+=20){
    ctx.beginPath();
    ctx.moveTo(i, H-40);
    ctx.lineTo(i-5, H-30);
    ctx.stroke();
  }
  
  // title text as background decoration
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = '#1e90ff';
  ctx.font = 'bold 120px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('捕鱼达人', W/2, H/2.5);
  ctx.globalAlpha = 1;
  
  // draw cannon/tower at bottom center
  const cannonX = W/2;
  const cannonY = H - 15;
  const cannonDir = Math.atan2(mouseY - cannonY, mouseX - cannonX);
  
  // cannon base (circular)
  ctx.fillStyle = '#8b7355';
  ctx.beginPath();
  ctx.arc(cannonX, cannonY, 16, 0, Math.PI*2);
  ctx.fill();
  ctx.strokeStyle = '#5d4e37';
  ctx.lineWidth = 2;
  ctx.stroke();
  
  // cannon barrel (pointing toward mouse)
  ctx.save();
  ctx.translate(cannonX, cannonY);
  ctx.rotate(cannonDir);
  ctx.fillStyle = '#654321';
  ctx.fillRect(0, -6, 40, 12);
  ctx.fillStyle = '#ffd700';
  ctx.beginPath();
  ctx.arc(38, 0, 5, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();
  
  // cannon highlight
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.beginPath();
  ctx.arc(cannonX - 4, cannonY - 6, 3, 0, Math.PI*2);
  ctx.fill();
  
  // draw fishes
  fishes.forEach(f=>f.draw(ctx));
  projectiles.forEach(p=>p.draw(ctx));
  nets.forEach(n=>n.draw(ctx));
  explosions.forEach(ex=>ex.draw(ctx));
  
  // draw active bait
  if(activeBait){
    ctx.fillStyle='rgba(255,220,120,0.9)';
    ctx.beginPath();
    ctx.arc(activeBait.x, activeBait.y, 12,0,Math.PI*2);
    ctx.fill();
    ctx.strokeStyle='rgba(255,200,80,0.6)';
    ctx.lineWidth=2;
    ctx.stroke();
    // bait pulse animation
    const pulse = Math.sin(performance.now()/200)*0.3+1;
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle='rgba(255,220,120,0.8)';
    ctx.beginPath();
    ctx.arc(activeBait.x, activeBait.y, 12*pulse, 0, Math.PI*2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  
  // draw float texts via DOM for crisp text
  renderFloatTexts();
}

function collectFish(f){ coins += f.type.value; updateHUD(); spawnFloatText(`+${f.type.value}`, f.x, f.y); playSound('coin'); }
function updateHUD(){ coinCountEl.textContent = coins }

function updateWeaponHUD(){
  missileAmmoEl.textContent = missileAmmo;
  netAmmoEl.textContent = netAmmo;
  // buttons
  btnMissile.disabled = !canFireMissile();
  btnNet.disabled = !canThrowNet();
  // show cooldown time on buttons when on cooldown
  const t = performance.now()/1000;
  const mRem = Math.max(0, missileCooldown - (t - missileLastFire));
  const nRem = Math.max(0, netCooldown - (t - netLastFire));
  btnMissile.textContent = btnMissile.disabled ? `发射导弹 (${mRem.toFixed(1)}s)` : '发射导弹';
  if(!netActivated){
    btnNet.textContent = btnNet.disabled ? `投掷渔网 (${nRem.toFixed(1)}s)` : '投掷渔网';
    if(!btnNet.disabled) btnNet.style.background = '';
  }
}

function spawnFloatText(text,x,y){ floatTexts.push({text,x,y,life:1.0}); }
function renderFloatTexts(){ // render into DOM elements
  // remove old
  document.querySelectorAll('.floatText').forEach(el=>el.remove());
  floatTexts.forEach(ft=>{
    const el = document.createElement('div'); el.className='floatText'; el.textContent=ft.text;
    el.style.left = Math.round((canvas.offsetLeft + ft.x)) + 'px';
    el.style.top = Math.round((canvas.offsetTop + ft.y - 20)) + 'px';
    el.style.opacity = Math.max(0, ft.life);
    document.body.appendChild(el);
  })
}

// mouse tracking for cannon aiming
canvas.addEventListener('mousemove', (e)=>{
  const rect = canvas.getBoundingClientRect();
  mouseX = e.clientX - rect.left;
  mouseY = e.clientY - rect.top;
});

// input: click to fire missile, or to deploy net if activated
canvas.addEventListener('click', (e)=>{
  const rect = canvas.getBoundingClientRect(); const x = e.clientX-rect.left; const y = e.clientY-rect.top;
  
  // if net mode is activated, deploy net at click location
  if(netActivated){
    if(!canThrowNet()) return;
    nets.push(new Net(x, y));
    netAmmo = Math.max(0, netAmmo-1);
    netLastFire = performance.now()/1000;
    playSound('net');
    netActivated = false;
    btnNet.textContent = '投掷渔网';
    btnNet.style.background = '';
    return;
  }
  
  // otherwise fire missile
  const px = W/2, py = H-20; // launcher center
  if(!canFireMissile()) return;
  // determine projectile properties based on selected mode
  const mode = missileModeSelect.value;
  const p = new Projectile(px,py,x,y);
  if(mode==='penetration' && upgrades.penetration){ p.penetrationRemaining = 3; }
  if(mode==='explosive' && upgrades.explosive){ p.explosive = true }
  projectiles.push(p);
  missileAmmo = Math.max(0, missileAmmo-1);
  missileLastFire = performance.now()/1000;
  playSound('fire');
});

btnMissile.addEventListener('click', ()=>{
  if(!canFireMissile()) return;
  const px=W/2, py=H-20; const tx = px, ty = 0;
  const p = new Projectile(px,py,tx,ty);
  const mode = missileModeSelect.value;
  if(mode==='penetration' && upgrades.penetration){ p.penetrationRemaining = 3 }
  if(mode==='explosive' && upgrades.explosive){ p.explosive = true }
  projectiles.push(p);
  missileAmmo = Math.max(0, missileAmmo-1);
  missileLastFire = performance.now()/1000;
  playSound('fire');
});

btnNet.addEventListener('click', ()=>{
  if(!canThrowNet()) return;
  netActivated = !netActivated;
  if(netActivated){
    btnNet.style.background = 'linear-gradient(135deg, #ff6347, #d84315)';
    btnNet.textContent = '点击投放🌐';
  } else {
    btnNet.style.background = '';
    btnNet.textContent = '投掷渔网';
  }
});

// shop events
btnShop.addEventListener('click', ()=>{ shopModal.style.display='flex'; });
shopClose.addEventListener('click', ()=>{ shopModal.style.display='none'; });
shopModal.addEventListener('click', (e)=>{ if(e.target===shopModal) shopModal.style.display='none'; });
document.querySelectorAll('#shopModal .buy').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const item = btn.getAttribute('data-item');
    attemptBuy(item, btn);
  })
});

function attemptBuy(item, btn){
  const costs = { penetration:300, explosive:350, net:200, bait:80 };
  const cost = costs[item];
  if(coins < cost) { alert('金币不足'); return }
  coins -= cost; updateHUD();
  if(item==='penetration'){ upgrades.penetration = true; }
  else if(item==='explosive'){ upgrades.explosive = true; }
  else if(item==='net'){ upgrades.netLevel = (upgrades.netLevel||0)+1; }
  else if(item==='bait'){ upgrades.baitCount = (upgrades.baitCount||0)+1 }
  saveUpgrades(); applyUpgradesToUI();
}

// bait deploy
let activeBait = null; // {x,y,life,ttl}
function deployBait(x,y){ if((upgrades.baitCount||0)<=0) return; upgrades.baitCount--; activeBait = {x,y,life:0,ttl:8}; saveUpgrades(); applyUpgradesToUI(); }
btnBait.addEventListener('click', ()=>{ if((upgrades.baitCount||0)<=0) return; deployBait(W/2, H/2); playSound('net'); });

// fish attraction to bait
function processBait(dt){ if(!activeBait) return; activeBait.life += dt; if(activeBait.life >= activeBait.ttl){ activeBait = null; return }
  fishes.forEach(f=>{
    const dx = activeBait.x - f.x; const dy = activeBait.y - f.y; const d = Math.hypot(dx,dy);
    if(d < 300){
      // steer fish toward bait
      const steer = 40 * dt; // pixels/sec adjustment
      const sign = Math.sign(dx);
      f.vx += (dx/d) * steer;
      // slowly move baseY toward bait y
      f.baseY += (activeBait.y - f.baseY) * 0.02;
    }
  })
}

// simple auto-spawn helper for demo
setInterval(()=>{ if(fishes.length<12) spawnFish(); }, 1500);

// initial HUD
updateHUD();
updateWeaponHUD();
