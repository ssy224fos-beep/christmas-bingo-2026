"use strict";

// All artwork is loaded from a local ZIP file. No PNG files are hosted by this site.
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const state = {
  artworks: [], remaining: [], draws: [], cards: [], currentCard: 0,
  spinning: false, displayMode: "text", order: "fixed", sound: false,
  audio: null, spinTimer: null, drumTimer: null, celebrationTimer: null,
  toastTimer: null
};
const SPIN_ITEM_HEIGHT = 250;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomInt = (length) => Math.floor(Math.random() * length);
const byId = (key) => state.artworks.find(item => item.id === key);

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => node.classList.remove("show"), 3600);
}

function setStage(view) {
  ["emptyStage", "spinner", "winPanel", "readyStage"].forEach(id => {
    $("#" + id).classList.toggle("is-hidden", id !== view);
  });
}

function updateButtons() {
  const loaded = state.artworks.length >= 16;
  $("#startBtn").disabled = !loaded || state.spinning || state.remaining.length === 0;
  $("#resetBtn").disabled = !loaded || state.spinning;
  $("#generateBtn").disabled = !loaded;
  $("#addCardBtn").disabled = !loaded;
  $("#regenerateBtn").disabled = !loaded || state.cards.length === 0;
  $("#pdfBtn").disabled = state.cards.length === 0;
}

async function loadZip(file) {
  if (!file) return;
  if (state.artworks.length && !confirm("画像を読み直すと抽選結果と生成済みカードを初期化します。続けますか？")) return;
  const message = $("#loadMessage");
  $("#loadBtn").disabled = true;
  message.textContent = "ZIPファイルを読み込んでいます…";
  const loaded = [];
  try {
    if (typeof JSZip === "undefined") throw new Error("ZIP読み込みライブラリを読み込めませんでした。ページを再読み込みしてください。");
    const zip = await JSZip.loadAsync(file);
    const entries = Object.values(zip.files).filter(entry => !entry.dir && /\.png$/i.test(entry.name) && !entry.name.includes("__MACOSX/") && !entry.name.startsWith("._"));
    if (entries.length < 16) throw new Error("PNG画像が16枚以上必要です。ZIPファイルを確認してください。");
    if (entries.length > 200) throw new Error("画像数が多すぎます。200枚以下のZIPファイルを選んでください。");
    const existingNames = new Set();
    for (const entry of entries) {
      const name = entry.name.split("/").pop().replace(/\.png$/i, "").normalize("NFC").trim();
      if (!name || existingNames.has(name)) throw new Error("ファイル名が空、または同じタイトルの画像が含まれています: " + name);
      existingNames.add(name);
      const data = await entry.async("blob");
      const url = URL.createObjectURL(new Blob([data], {type: "image/png"}));
      const img = new Image();
      img.src = url;
      try { await img.decode(); } catch { URL.revokeObjectURL(url); throw new Error("画像が開けません: " + name); }
      loaded.push({id: name, name, url, img});
    }
    // Only replace previous data after the new ZIP was fully validated.
    state.artworks.forEach(item => URL.revokeObjectURL(item.url));
    state.artworks = loaded;
    state.remaining = loaded.map(item => item.id);
    state.draws = [];
    state.cards = [];
    state.currentCard = 0;
    state.displayMode = "text";
    state.order = "fixed";
    $$("[data-mode]").forEach(el => el.classList.toggle("is-selected", el.dataset.mode === "text"));
    $$("[data-order]").forEach(el => el.classList.toggle("is-selected", el.dataset.order === "fixed"));
    renderHistory();
    renderCards();
    setStage("readyStage");
    updateButtons();
    $("#welcomeOverlay").classList.add("is-hidden");
    $("#gameCaption").textContent = "全" + loaded.length + "種類から重複せずに抽選します";
    toast(loaded.length + "種類のイラストを読み込みました");
  } catch (error) {
    loaded.forEach(item => URL.revokeObjectURL(item.url));
    message.textContent = "読み込み失敗：" + (error?.message || error);
    toast("ZIPの読み込みに失敗しました");
  } finally {
    $("#loadBtn").disabled = false;
    $("#zipFileInput").value = "";
  }
}

function renderHistory() {
  $("#drawnCount").textContent = state.draws.length;
  $("#remainingCount").textContent = state.remaining.length;
  const list = $("#historyList");
  list.replaceChildren();
  list.className = "history-list " + (state.displayMode === "image" ? "image-mode" : "text-mode");
  if (!state.artworks.length) return;
  const ids = state.order === "fixed"
    ? state.artworks.map(item => item.id)
    : [...state.draws].reverse();
  if (!ids.length) {
    const p = document.createElement("div");
    p.className = "history-item empty";
    p.textContent = "まだ抽選されていません";
    list.append(p);
    return;
  }
  const usedIds = new Set(state.draws);
  ids.forEach((id, index) => {
    const art = byId(id);
    const cell = document.createElement("div");
    cell.className = "history-item" + (state.displayMode === "image" ? " image-item" : "") + (usedIds.has(id) && state.order === "fixed" ? " used" : "");
    if (state.order === "drawn") {
      const serial = document.createElement("span");
      serial.className = "history-number";
      serial.textContent = "No." + String(state.draws.length - index).padStart(2,"0");
      cell.append(serial);
    }
    if (state.displayMode === "image") {
      const img = document.createElement("img");
      img.src = art.url;
      img.alt = "";
      img.loading = "lazy";
      cell.append(img);
    }
    const label = document.createElement("span");
    label.textContent = art.name;
    cell.append(label);
    list.append(cell);
  });
}

function renderSpinner() {
  const list = $("#spinnerList");
  list.replaceChildren();
  for (let i = 0; i < 8; i++) {
    for (const art of state.artworks) {
      const row = document.createElement("div");
      row.className = "spin-item";
      const img = document.createElement("img");
      img.src = art.url;
      img.alt = "";
      const label = document.createElement("span");
      label.textContent = art.name;
      row.append(img, label);
      list.append(row);
    }
  }
  list.style.transition = "none";
  list.style.transform = "translateY(0px)";
}

function audioContext() {
  if (!state.sound) return null;
  if (!state.audio) state.audio = new (window.AudioContext || window.webkitAudioContext)();
  if (state.audio.state === "suspended") state.audio.resume().catch(() => {});
  return state.audio;
}
function tone(freq, startDelay, duration, volume = 0.045, shape = "sine") {
  const ctx = audioContext();
  if (!ctx) return;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  const start = ctx.currentTime + startDelay;
  oscillator.type = shape;
  oscillator.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(.001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(.002,volume), start + Math.min(.018,duration/4));
  gain.gain.exponentialRampToValueAtTime(.001, start + duration);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + .01);
}
function drumTick() {
  const ctx = audioContext();
  if (!ctx) return;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  const start = ctx.currentTime;
  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(135, start);
  oscillator.frequency.exponentialRampToValueAtTime(48, start + .09);
  gain.gain.setValueAtTime(.12, start);
  gain.gain.exponentialRampToValueAtTime(.001, start + .1);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + .11);
}
function stopDrums() { if (state.drumTimer) clearInterval(state.drumTimer); state.drumTimer = null; }
function startDrums() {
  if (!state.sound) return;
  drumTick();
  state.drumTimer = setInterval(drumTick, 130);
}
function playWinSound() {
  [392,494,587,784].forEach((f,i)=>tone(f,i*.11,.52,.055,i===3?"sine":"triangle"));
  tone(1175,.4,.75,.025);
}
function playFinalSound() {
  [523,659,784,1046,1318].forEach((f,i)=>tone(f,i*.16,.5,.05));
  [784,1046,1318].forEach(f=>tone(f,.95,.85,.025));
}
function showSparkles() {
  const root = $("#sparkles");
  root.replaceChildren();
  for(let i=0;i<24;i++){
    const s = document.createElement("span");
    s.className = "sparkle";
    s.textContent = i%3===0 ? "❄" : "✦";
    const r = Math.random()*Math.PI*2;
    const distance = 85 + Math.random()*190;
    s.style.setProperty("--x", Math.cos(r)*distance+"px");
    s.style.setProperty("--y", Math.sin(r)*distance+"px");
    s.style.animationDelay = Math.random()*.2+"s";
    root.append(s);
  }
  setTimeout(()=>root.replaceChildren(),1600);
}
function showCelebration() {
  const root = $("#celebrationStars");
  root.replaceChildren();
  const symbols = ["🎉","❄","⭐","🎁","✦"];
  for(let i=0;i<38;i++){
    const s=document.createElement("span");
    s.className="celebration-star";
    s.textContent=symbols[i%symbols.length];
    s.style.setProperty("--left",Math.random()*100+"%");
    s.style.setProperty("--sz",(17+Math.random()*27)+"px");
    s.style.setProperty("--dur",(2+Math.random()*2)+"s");
    s.style.animationDelay=Math.random()*.6+"s";
    root.append(s);
  }
  $("#celebration").classList.remove("is-hidden");
  playFinalSound();
  clearTimeout(state.celebrationTimer);
  state.celebrationTimer = setTimeout(() => $("#celebration").classList.add("is-hidden"),4300);
}

async function spin() {
  if (state.spinning || !state.remaining.length || !state.artworks.length) return;
  state.spinning = true;
  const winnerPosition = randomInt(state.remaining.length);
  const winnerId = state.remaining[winnerPosition];
  const winArt = byId(winnerId);
  updateButtons();
  renderSpinner();
  setStage("spinner");
  const list = $("#spinnerList");
  const index = (5 + randomInt(3)) * state.artworks.length + state.artworks.findIndex(a => a.id === winnerId);
  const duration = 4500 + Math.random()*1500;
  // Force layout between the reset and the transition.
  void list.offsetHeight;
  list.style.transition = "transform " + duration + "ms cubic-bezier(.12,.85,.18,1)";
  list.style.transform = "translateY(-" + (index*SPIN_ITEM_HEIGHT) + "px)";
  startDrums();
  await sleep(duration + 110);
  stopDrums();
  state.draws.push(winnerId);
  state.remaining.splice(winnerPosition,1);
  $("#winImage").src = winArt.url;
  $("#winImage").alt = winArt.name;
  $("#winTitle").textContent = winArt.name;
  setStage("winPanel");
  const winPanel = $("#winPanel");
  winPanel.classList.remove("win-pop");
  void winPanel.offsetWidth;
  winPanel.classList.add("win-pop");
  playWinSound();
  showSparkles();
  renderHistory();
  state.spinning = false;
  updateButtons();
  if (state.remaining.length === 0) {
    setTimeout(showCelebration, 1200);
    $("#gameCaption").textContent = "全種類の抽選が終了しました。リセットして最初から遊べます。";
  }
}
function resetDraw() {
  if (state.spinning || !state.artworks.length) return;
  if (!confirm("抽選済みの履歴をすべてリセットしますか？（カードはそのまま残ります）")) return;
  stopDrums();
  state.remaining = state.artworks.map(item=>item.id);
  state.draws = [];
  renderHistory();
  setStage("readyStage");
  $("#gameCaption").textContent = "全" + state.artworks.length + "種類から重複せずに抽選します";
  updateButtons();
}

function shuffled(items) {
  const a = [...items];
  for(let i=a.length-1;i>0;i--){const j=randomInt(i+1);[a[i],a[j]]=[a[j],a[i]];}
  return a;
}
function cardSignature(items) { return items.join("\u241f"); }
function newCard(index, previousSignatures) {
  for(let attempts=0;attempts<500;attempts++){
    const items = shuffled(state.artworks.map(a=>a.id)).slice(0,16);
    const signature = cardSignature(items);
    if(!previousSignatures.has(signature)){
      previousSignatures.add(signature);
      return {number:index+1,items};
    }
  }
  throw new Error("重複しないカードを生成できませんでした。");
}
function generateCards(count) {
  if (state.artworks.length < 16) return;
  const signatures = new Set();
  const newCards = [];
  for(let i=0;i<count;i++) newCards.push(newCard(i,signatures));
  state.cards = newCards;
  state.currentCard = 0;
  renderCards();
}
function drawCardDom(card) {
  const root = $("#previewCard");
  root.replaceChildren();
  const top = document.createElement("div");
  top.className = "card-topline";
  const title = document.createElement("img");
  title.className = "card-title-graphic";
  title.src = "./assets/card-title.svg";
  title.alt = "CHRISTMAS BINGO!";
  const number = document.createElement("span");
  number.className = "card-number";
  number.textContent = "No." + String(card.number).padStart(3,"0");
  top.append(title,number);
  const grid = document.createElement("div");
  grid.className = "card-grid";
  card.items.forEach(id => {
    const art = byId(id);
    const cell = document.createElement("div");
    cell.className = "card-cell";
    const img = document.createElement("img");
    img.src = art.url;
    img.alt = art.name;
    const label = document.createElement("span");
    label.textContent = art.name;
    cell.append(img,label);
    grid.append(cell);
  });
  const name = document.createElement("div");
  name.className = "name-row";
  name.textContent = "なまえ：";
  const blank = document.createElement("span");
  blank.className = "name-blank";
  name.append(blank);
  root.append(top,grid,name);
}
function renderCards() {
  const count=state.cards.length;
  $("#cardsCountLabel").textContent = "生成済み："+count+"枚";
  $("#pagerText").textContent = count ? (state.currentCard+1)+" / "+count : "0 / 0";
  $("#cardPosition").textContent = count ? "No."+String(state.cards[state.currentCard].number).padStart(3,"0") : "まだカードがありません";
  $("#previewEmpty").classList.toggle("is-hidden", count>0);
  $("#previewCard").classList.toggle("is-hidden", count===0);
  $("#prevCardBtn").disabled=count===0||state.currentCard<=0;
  $("#nextCardBtn").disabled=count===0||state.currentCard>=count-1;
  if(count) drawCardDom(state.cards[state.currentCard]);
  updateButtons();
}
function addCard() {
  if (state.artworks.length < 16) return;
  const signatures = new Set(state.cards.map(card=>cardSignature(card.items)));
  state.cards.push(newCard(state.cards.length,signatures));
  state.currentCard=state.cards.length-1;
  renderCards();
}

let printTitleImage=null;
function loadPrintTitleImage() {
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>resolve(img);
    img.onerror=()=>reject(new Error("card-title.svg could not load"));
    img.src="./assets/card-title.svg";
  });
}
function roundRect(ctx,x,y,w,h,r,fill,stroke,lineWidth=1) {
  ctx.beginPath();ctx.roundRect(x,y,w,h,r);
  if(fill){ctx.fillStyle=fill;ctx.fill();}
  if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=lineWidth;ctx.stroke();}
}
function containImage(ctx,img,x,y,w,h) {
  if(!img?.naturalWidth || !img.naturalHeight)return;
  const ratio=Math.min(w/img.naturalWidth,h/img.naturalHeight);
  const rw=img.naturalWidth*ratio,rh=img.naturalHeight*ratio;
  ctx.drawImage(img,x+(w-rw)/2,y+(h-rh)/2,rw,rh);
}
function fitFont(ctx,text,maxWidth,defaultSize,minSize=19,weight="bold") {
  let size=defaultSize;
  while(size>minSize){ctx.font=weight+" "+size+"px 'Yu Gothic', Meiryo, sans-serif"; if(ctx.measureText(text).width<=maxWidth)break;size--;}
  ctx.font=weight+" "+size+"px 'Yu Gothic', Meiryo, sans-serif";
  return size;
}
function paintPrintableCard(ctx,card,x,y,w,h) {
  ctx.save();ctx.translate(x,y);
  roundRect(ctx,1,1,w-2,h-2,19,"#fff7e6","#c43848",11);
  roundRect(ctx,12,12,w-24,h-24,13,null,"#efd080",7);
  // Draw the same decorative title graphic in the printed PDF.
  if (printTitleImage) containImage(ctx,printTitleImage,34,17,w-68,112);
  ctx.textAlign="right";ctx.fillStyle="#246342";
  ctx.font="bold 25px Meiryo,sans-serif";
  ctx.fillText("No."+String(card.number).padStart(3,"0"),w-38,136);
  const left=34,right=34, gap=10, top=157, bottom=119;
  const cw=(w-left-right-3*gap)/4;
  const ch=(h-top-bottom-3*gap)/4;
  card.items.forEach((id,i)=>{
    const art=byId(id),col=i%4,row=Math.floor(i/4);
    const sx=left+col*(cw+gap),sy=top+row*(ch+gap);
    roundRect(ctx,sx,sy,cw,ch,9,i%2===0?"#fffdfa":"#edf5e8","#e6b45e",3);
    containImage(ctx,art.img,sx+13,sy+15,cw-26,ch-63);
    ctx.textAlign="center";ctx.textBaseline="alphabetic";ctx.fillStyle="#243e2d";
    fitFont(ctx,art.name,cw-8,23,14,"bold");
    ctx.fillText(art.name,sx+cw/2,sy+ch-18);
  });
  ctx.fillStyle="#236345";ctx.textAlign="left";ctx.textBaseline="alphabetic";
  ctx.font="bold 30px 'Yu Gothic',Meiryo,sans-serif";
  ctx.fillText("なまえ：",36,h-51);
  ctx.strokeStyle="#256344";ctx.lineWidth=3;
  ctx.beginPath();ctx.moveTo(179,h-48);ctx.lineTo(w-39,h-48);ctx.stroke();
  ctx.restore();
}
function createPdfPage(cardA,cardB) {
  const canvas=document.createElement("canvas");
  canvas.width=2100;canvas.height=1485;
  const ctx=canvas.getContext("2d",{alpha:false});
  ctx.fillStyle="#fff";ctx.fillRect(0,0,2100,1485);
  paintPrintableCard(ctx,cardA,66,47,928,1387);
  if(cardB) paintPrintableCard(ctx,cardB,1106,47,928,1387);
  ctx.strokeStyle="#888";ctx.lineWidth=2;ctx.setLineDash([13,12]);ctx.beginPath();ctx.moveTo(1050,15);ctx.lineTo(1050,1470);ctx.stroke();ctx.setLineDash([]);
  // Small scissor guides: the whole page retains margins on all sides.
  return canvas;
}
function bytes(text) { return new TextEncoder().encode(text); }
function base64ToBytes(encoded) {
  const binary=atob(encoded);const array=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) array[i]=binary.charCodeAt(i);
  return array;
}
function buildPdf(jpegs) {
  // Each A4 page is rasterized first, preserving all Japanese labels without font embedding.
  const chunks=[],offsets=[0];let cursor=0;
  function append(chunk){chunks.push(chunk);cursor+=chunk.length;}
  function ascii(text){append(bytes(text));}
  function obj(id,chunksForObject){
    offsets[id]=cursor;ascii(id+" 0 obj\n");
    for(const chunk of chunksForObject)typeof chunk==="string"?ascii(chunk):append(chunk);
    ascii("\nendobj\n");
  }
  ascii("%PDF-1.4\n%\x80\x81\x82\x83\n");
  obj(1,["<< /Type /Catalog /Pages 2 0 R >>"]);
  const kids=jpegs.map((_,i)=>3+i*3+" 0 R").join(" ");
  obj(2,["<< /Type /Pages /Count "+jpegs.length+" /Kids [ "+kids+" ] >>"]);
  jpegs.forEach((jpg,i)=>{
    const page=3+i*3,content=page+1,image=page+2;
    obj(page,["<< /Type /Page /Parent 2 0 R /MediaBox [0 0 841.89 595.28] /Resources << /XObject << /Im0 "+image+" 0 R >> >> /Contents "+content+" 0 R >>"]);
    const stream="q\n841.89 0 0 595.28 0 0 cm\n/Im0 Do\nQ\n";
    obj(content,["<< /Length "+bytes(stream).length+" >>\nstream\n",stream,"endstream"]);
    obj(image,["<< /Type /XObject /Subtype /Image /Width 2100 /Height 1485 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length "+jpg.length+" >>\nstream\n",jpg,"\nendstream"]);
  });
  const xref=cursor;
  ascii("xref\n0 "+(offsets.length)+"\n0000000000 65535 f \n");
  for(let id=1;id<offsets.length;id++)ascii(String(offsets[id]).padStart(10,"0")+" 00000 n \n");
  ascii("trailer\n<< /Size "+offsets.length+" /Root 1 0 R >>\nstartxref\n"+xref+"\n%%EOF");
  return new Blob(chunks,{type:"application/pdf"});
}
async function exportPdf() {
  if (!state.cards.length) return;
  try { printTitleImage = await loadPrintTitleImage(); }
  catch(error) { toast("タイトル画像を読み込めませんでした"); return; }
  const button=$("#pdfBtn");
  button.disabled=true;button.textContent="PDFを作成中…";
  try {
    const jpegs=[];
    for(let i=0;i<state.cards.length;i+=2){
      const canvas=createPdfPage(state.cards[i],state.cards[i+1]);
      jpegs.push(base64ToBytes(canvas.toDataURL("image/jpeg",.9).split(",")[1]));
      await sleep(0);
    }
    const blob=buildPdf(jpegs);
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement("a");
    anchor.href=url;anchor.download="christmas-bingo-cards-"+state.cards.length+".pdf";
    document.body.append(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    toast("PDFを作成しました（A4横向き・2枚／ページ）");
  }catch(error){console.error(error);toast("PDF生成に失敗しました: "+(error.message||error));}
  finally{button.textContent="📄 PDFを出力";updateButtons();}
}

function changeTab(tab) {
  $$(".tab").forEach(button=>{
    const active=button.dataset.tab===tab;
    button.classList.toggle("is-active",active);
    button.setAttribute("aria-selected",String(active));
  });
  $("#rouletteScreen").classList.toggle("is-active",tab==="roulette");
  $("#cardsScreen").classList.toggle("is-active",tab==="cards");
}
async function toggleFullscreen() {
  const focus=!document.body.classList.contains("focus-mode");
  document.body.classList.toggle("focus-mode",focus);
  $("#fullscreenBtn").innerHTML=focus?"⛶ <span>通常表示</span>":"⛶ <span>画面拡大</span>";
  if (focus && document.documentElement.requestFullscreen) {
    try {await document.documentElement.requestFullscreen();} catch { /* iPad Safari: use focus layout */ }
  } else if (!focus && document.fullscreenElement && document.exitFullscreen) {
    try {await document.exitFullscreen();} catch { /* fallback remains usable */ }
  }
}

function init() {
  $("#loadBtn").addEventListener("click",()=>$("#zipFileInput").click());
  $("#stageLoadBtn").addEventListener("click",()=>$("#zipFileInput").click());
  $("#zipFileInput").addEventListener("change",event=>loadZip(event.target.files?.[0]));
  $$(".tab").forEach(button=>button.addEventListener("click",()=>changeTab(button.dataset.tab)));
  $$("[data-mode]").forEach(button=>button.addEventListener("click",()=>{
    state.displayMode=button.dataset.mode;
    $$("[data-mode]").forEach(other=>other.classList.toggle("is-selected",other===button));
    renderHistory();
  }));
  $$("[data-order]").forEach(button=>button.addEventListener("click",()=>{
    state.order=button.dataset.order;
    $$("[data-order]").forEach(other=>other.classList.toggle("is-selected",other===button));
    renderHistory();
  }));
  $("#startBtn").addEventListener("click",spin);
  $("#resetBtn").addEventListener("click",resetDraw);
  $("#soundBtn").addEventListener("click",()=>{
    state.sound=!state.sound;
    $("#soundBtn").textContent=state.sound?"♫ 効果音 ON":"♫ 効果音 OFF";
    $("#soundBtn").setAttribute("aria-pressed",String(state.sound));
    if (state.sound) {audioContext();tone(600,0,.13,.02);}
    else stopDrums();
  });
  $("#generateBtn").addEventListener("click",()=>{
    const count=Number($("#cardCountInput").value);
    if(!Number.isInteger(count)||count<1||count>200){toast("作成枚数は1〜200枚で指定してください");return;}
    if(state.cards.length && !confirm("現在のカードをすべて置き換えますか？"))return;
    generateCards(count);toast(count+"枚のカードを生成しました");
  });
  $("#addCardBtn").addEventListener("click",()=>{
    if(state.cards.length>=200){toast("カードは最大200枚までです");return;}
    addCard();toast("カードを1枚追加しました");
  });
  $("#regenerateBtn").addEventListener("click",()=>{
    if(!state.cards.length)return;
    if(confirm("現在の"+state.cards.length+"枚をすべて再生成しますか？")){
      generateCards(state.cards.length);toast("全カードを再生成しました");
    }
  });
  $("#prevCardBtn").addEventListener("click",()=>{if(state.currentCard>0){state.currentCard--;renderCards();}});
  $("#nextCardBtn").addEventListener("click",()=>{if(state.currentCard<state.cards.length-1){state.currentCard++;renderCards();}});
  $("#pdfBtn").addEventListener("click",exportPdf);
  $("#fullscreenBtn").addEventListener("click",toggleFullscreen);
  document.addEventListener("fullscreenchange",()=>{
    if(!document.fullscreenElement && document.body.classList.contains("focus-mode")){
      document.body.classList.remove("focus-mode");
      $("#fullscreenBtn").innerHTML="⛶ <span>画面拡大</span>";
    }
  });
  renderHistory();renderCards();
}
init();