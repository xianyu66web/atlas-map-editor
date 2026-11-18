'use strict';

// Version 3 keeps one tile per cell. Its artwork is part of the tile's data.
function validateBlockArt(v) {
 const assets=Object.create(null);
 for(const [id,image] of Object.entries(v.artAssets||{})) {
  if(typeof id!=='string'||!validTileImage(image))throw Error('方块图片无效');
  assets[id]=image;
 }
 const tileArt={};
 for(const [k,a] of Object.entries(v.tileArt||{})) {
  if(!Object.hasOwn(v.cells,k))continue;
  if(a&&a.flipX!==undefined&&typeof a.flipX!=='boolean')throw Error('方块镜像无效');
  const mirror=a?.flipX?{flipX:true}:{};
  if(a&&a.turns!==undefined&&!Number.isInteger(a.turns))throw Error('方块旋转无效');
  if(a&&!a.asset){tileArt[k]={...mirror,turns:((a.turns||0)%4+4)%4};continue}
  if(!a||!assets[a.asset]||!['sx','sy','sw','sh'].every(n=>Number.isInteger(a[n])&&a[n]>=0&&a[n]<=8192)||a.sw<1||a.sh<1)throw Error('方块图案裁切无效');
  tileArt[k]={...mirror,asset:a.asset,sx:a.sx,sy:a.sy,sw:a.sw,sh:a.sh,turns:((a.turns||0)%4+4)%4};
 }
 return {artAssets:assets,tileArt,cameraRooms:validateCameraRooms(v.cameraRooms||[]),artVersion:v.artVersion===3?3:undefined};
}
function validateCameraRooms(rooms) {
 if(!Array.isArray(rooms)||rooms.length>2000)throw Error('镜头房间无效');
 const ids=new Set();
 return rooms.map(r=>{
  if(!r||typeof r.id!=='string'||ids.has(r.id)||!['x','y','w','h'].every(k=>Number.isInteger(r[k])&&Math.abs(r[k])<=100000)||r.w<1||r.h<1)throw Error('镜头房间范围无效');
  ids.add(r.id);
  return {id:r.id,name:String(r.name||'房间').slice(0,40),x:r.x,y:r.y,w:r.w,h:r.h,mode:r.mode==='follow'?'follow':'fixed',exits:Array.isArray(r.exits)?r.exits.filter(e=>e&&typeof e.to==='string'&&['left','right','top','bottom'].includes(e.side)&&Number.isFinite(e.offset)).map(e=>({to:e.to,side:e.side,offset:Math.max(0,Math.min(1,e.offset))})):[]};
 });
}
function upgradeBlockArt(w) {
 w.tileArt=w.tileArt||{};w.artAssets=w.artAssets||{};w.cameraRooms=w.cameraRooms||[];
 if(w.artVersion===3)return w;
 const source=window.PROJECT_MAP;
 if(source?.tileArt) {
  const originals=new Map(source.types.map(t=>[t.id,t]));
  const compatible=new Set(w.types.filter(t=>originals.has(t.id)&&(!t.image||t.image===originals.get(t.id).image||t.image===window.PROJECT_ART?.legacyImages?.[t.id])).map(t=>t.id));
  for(const [k,type] of Object.entries(w.cells)) {
   const a=source.tileArt[k];
   if(a&&!w.tileArt[k]&&source.cells[k]===type&&compatible.has(type)) {
    w.tileArt[k]={...a};w.artAssets[a.asset]=source.artAssets[a.asset];
   }
  }
  for(const t of w.types)if(compatible.has(t.id)&&!t.image&&originals.get(t.id)?.image){t.image=originals.get(t.id).image;t.autoPattern=false}
 }
 w.artVersion=3;delete w.art;delete w.artRef;
 return w;
}
function pruneBlockArt(w) {
 const used=new Set();
 for(const k of Object.keys(w.tileArt||{})) {
  if(!w.cells[k])delete w.tileArt[k];else if(w.tileArt[k].asset)used.add(w.tileArt[k].asset);
 }
 for(const id of Object.keys(w.artAssets||{}))if(!used.has(id))delete w.artAssets[id];
}
function putTile(k,type,group,art) {
 if(!insideRoomDetail(...xy(k)))return;
 world.cells[k]=type;
 delete world.members[k];if(group)world.members[k]=group;
 delete world.tileArt[k];if(art)world.tileArt[k]={...art};
 updateTerrainCell(k);
}
function eraseTile(k,wholeScene=false) {
 if(wholeScene!==true&&!insideRoomDetail(...xy(k)))return;
 delete world.cells[k];delete world.members[k];delete world.tileArt[k];updateTerrainCell(k);
}
function paintTileArtwork(c,k,type,x,y,size) {
 if(!$('showArt').checked)return;
 const a=world.tileArt?.[k],source=a&&world.artAssets?.[a.asset];
 if(!source){c.save();c.translate(x+size/2,y+size/2);c.rotate((a?.turns||0)*Math.PI/2);if(a?.flipX)c.scale(-1,1);paintTile(c,type,-size/2,-size/2,size,size);c.restore();return}
 const image=tileImage({image:source});if(!image)return;
 c.save();c.imageSmoothingEnabled=false;c.translate(x+size/2,y+size/2);c.rotate((a.turns||0)*Math.PI/2);if(a.flipX)c.scale(-1,1);
 c.drawImage(image,a.sx,a.sy,a.sw,a.sh,-size/2,-size/2,size,size);c.restore();
}

// Maintain a spatial index and rasterize only changed 32-by-32 chunks.
let terrainIndex=null,imageGeneration=0,renderedTiles=0,selectionOutline=null;
const rasterChunks=new Map();
function resetTerrainIndex(){terrainIndex=null;rasterChunks.clear()}
function buildTerrainIndex() {
 const chunks=new Map(),groups=new Map();
 for(const [k,id] of Object.entries(world.cells)) {
  const [x,y]=xy(k),ck=key(Math.floor(x/32),Math.floor(y/32));
  if(!chunks.has(ck))chunks.set(ck,{x:Math.floor(x/32)*32,y:Math.floor(y/32)*32,entries:new Map(),revision:0});
  const g=world.members[k],entry={k,id,x,y,g};chunks.get(ck).entries.set(k,entry);if(g){if(!groups.has(g))groups.set(g,new Set());groups.get(g).add(k)}
 }
 terrainIndex={cells:world.cells,chunks,groups};return terrainIndex;
}
function spatialIndex(){return terrainIndex?.cells===world.cells?terrainIndex:buildTerrainIndex()}
function updateTerrainCell(k) {
 if(terrainIndex?.cells!==world.cells)return;
 const [x,y]=xy(k),ck=key(Math.floor(x/32),Math.floor(y/32));
 let chunk=terrainIndex.chunks.get(ck);
 if(!chunk){chunk={x:Math.floor(x/32)*32,y:Math.floor(y/32)*32,entries:new Map(),revision:0};terrainIndex.chunks.set(ck,chunk)}
 const oldGroup=chunk.entries.get(k)?.g;if(oldGroup)terrainIndex.groups.get(oldGroup)?.delete(k);
 if(world.cells[k]){const g=world.members[k];chunk.entries.set(k,{k,id:world.cells[k],x,y,g});if(g){if(!terrainIndex.groups.has(g))terrainIndex.groups.set(g,new Set());terrainIndex.groups.get(g).add(k)}}else chunk.entries.delete(k);
 chunk.revision++;
 if(!chunk.entries.size){terrainIndex.chunks.delete(ck);rasterChunks.delete(chunk)}
}
function allTerrainEntries(){return [...spatialIndex().chunks.values()].flatMap(c=>[...c.entries.values()])}
function visibleTerrainChunks() {
 const left=-view.x/view.s,top=-view.y/view.s,right=(W-view.x)/view.s,bottom=(H-view.y)/view.s;
 return [...spatialIndex().chunks.values()].filter(c=>c.x<=right&&c.y<=bottom&&c.x+32>=left&&c.y+32>=top);
}
function drawTerrainChunks(s,types) {
 renderedTiles=0;
 const pixels=s<4?4:s<10?8:16;
 const moving=gesture?.kind==='move'?selected:null;
 for(const chunk of visibleTerrainChunks()) {
  let cached=rasterChunks.get(chunk);
  const showImages=$('showArt').checked;
  if(!cached||cached.revision!==chunk.revision||cached.types!==world.types||cached.images!==imageGeneration||cached.art!==world.tileArt||cached.showImages!==showImages||cached.moving!==moving||cached.pixels!==pixels) {
   const image=document.createElement('canvas');image.width=image.height=32*pixels;const c=image.getContext('2d');
   for(const p of chunk.entries.values()) {
    const x=(p.x-chunk.x)*pixels,y=(p.y-chunk.y)*pixels,type=types[p.id];
    c.globalAlpha=moving?.has(p.k)?.25:1;c.fillStyle=type?.color||'#999';c.fillRect(x,y,pixels,pixels);
    paintTileArtwork(c,p.k,type,x,y,pixels);
   }
   cached={image,revision:chunk.revision,types:world.types,images:imageGeneration,art:world.tileArt,showImages,moving,pixels};
   rasterChunks.delete(chunk);rasterChunks.set(chunk,cached);
  }
  rasterChunks.delete(chunk);rasterChunks.set(chunk,cached);
  // Snap both shared chunk edges to the same physical pixel. Fractional
  // destination rectangles otherwise blend their transparent edges into seams.
  const dpr=devicePixelRatio,left=Math.round((chunk.x*s+view.x)*dpr),top=Math.round((chunk.y*s+view.y)*dpr);
  const right=Math.round(((chunk.x+32)*s+view.x)*dpr),bottom=Math.round(((chunk.y+32)*s+view.y)*dpr);
  ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.imageSmoothingEnabled=false;
  ctx.drawImage(cached.image,left,top,right-left,bottom-top);ctx.restore();renderedTiles+=chunk.entries.size;
 }
 // Lower-resolution overview caches allow large maps to remain within the memory budget.
 let bytes=[...rasterChunks.values()].reduce((total,c)=>total+c.image.width*c.image.height*4,0);
 while(bytes>96*1024*1024){const oldest=rasterChunks.keys().next().value;const cached=rasterChunks.get(oldest);bytes-=cached.image.width*cached.image.height*4;rasterChunks.delete(oldest)}
 ctx.strokeStyle='#edfff6';ctx.lineWidth=1.5;
 if(s<5&&selected.size){if(selectionOutline?.selection!==selected||selectionOutline.count!==selected.size)selectionOutline={selection:selected,count:selected.size,box:bounds([...selected])};const b=selectionOutline.box;ctx.strokeRect(b.x*s,b.y*s,b.w*s,b.h*s)}else for(const k of selected){const[x,y]=xy(k);if(x*s+view.x<-s||y*s+view.y<-s||x*s+view.x>W||y*s+view.y>H)continue;ctx.strokeRect(x*s+1,y*s+1,Math.max(.5,s-2),Math.max(.5,s-2))}
}

// Each undo record contains only changed cell values and changed metadata fields.
let pendingHistory=null;
const historyDictionaries=['cells','members','tileArt'];
function copyMetadata(value) {
 if(Array.isArray(value))return value.map(v=>v&&typeof v==='object'?{...v}:v);
 if(value&&typeof value==='object')return {...value};
 return value;
}
function sameValue(a,b) {
 if(a===b)return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
 const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&sameValue(a[k],b[k]));
}
function beginHistory() {
 commitHistory();world.activeGroup=activeGroup;
 const metadata={};for(const k of Object.keys(world))if(!historyDictionaries.includes(k))metadata[k]=copyMetadata(world[k]);
 pendingHistory={world,dicts:Object.fromEntries(historyDictionaries.map(k=>[k,{...(world[k]||{})}])),metadata};
}
function commitHistory() {
 if(!pendingHistory)return;
 const before=pendingHistory;pendingHistory=null;if(before.world!==world)return;world.activeGroup=activeGroup;
 const patch={dicts:{},metadata:{}};let count=0;
 for(const name of historyDictionaries) {
  const a=before.dicts[name],b=world[name]||{},changes=[];
  for(const k of new Set([...Object.keys(a),...Object.keys(b)]))if(!sameValue(a[k],b[k])){changes.push([k,a[k],b[k]]);updateTerrainCell(k)}
  if(changes.length){patch.dicts[name]=changes;count+=changes.length}
 }
 for(const k of new Set([...Object.keys(before.metadata),...Object.keys(world).filter(k=>!historyDictionaries.includes(k))])) {
  if(!sameValue(before.metadata[k],world[k])){patch.metadata[k]=[before.metadata[k],copyMetadata(world[k])];count++}
 }
 if(count){history.push(patch);if(history.length>70)history.shift();future=[]}
}
function applyHistory(patch,direction) {
 for(const [name,changes] of Object.entries(patch.dicts))for(const[k,before,after]of changes){const value=direction?after:before;if(value===undefined)delete world[name][k];else world[name][k]=value}
 for(const[k,values]of Object.entries(patch.metadata)){const value=values[direction];if(value===undefined)delete world[k];else world[k]=copyMetadata(value)}
 activeGroup=world.activeGroup||'';resetTerrainIndex();
}

// Images are stored once in IndexedDB. Map writes include only the dirty map.
const mapGenerations=new Map(),savedMapGenerations=new Map(),pendingDeletionJournal=new Set();
const pendingSceneTrash=new Map();
const persistedResourceIds=new Set();
const savedResources=new Map(),imageResourceIds=new Map(),dirtyMapIds=new Set(),removedMapIds=new Set();
let editorDatabase=null,storageBooting=false,storageReady=Promise.resolve(),saveQueue=Promise.resolve(),saveSerial=0;
function resourceId(image) {
 if(imageResourceIds.has(image))return imageResourceIds.get(image);
 let hash=2166136261;for(let i=0;i<image.length;i++)hash=Math.imul(hash^image.charCodeAt(i),16777619);
 const base='img-'+(hash>>>0).toString(36)+'-'+image.length;let id=base,n=0;
 while(savedResources.has(id)&&savedResources.get(id)!==image)id=base+'-'+(++n);
 savedResources.set(id,image);imageResourceIds.set(image,id);return id;
}
function packImages(value) {
 if(typeof value==='string'&&validTileImage(value))return {$image:resourceId(value)};
 if(Array.isArray(value))return value.map(packImages);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,packImages(v)]));
 return value;
}
function unpackImages(value) {
 if(value&&typeof value==='object'&&typeof value.$image==='string') {
  const image=savedResources.get(value.$image);if(!image)throw Error('保存的图片资源缺失');return image;
 }
 if(Array.isArray(value))return value.map(unpackImages);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,unpackImages(v)]));
 return value;
}
function databaseRequest(request){return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
function databaseTransaction(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error||Error('保存事务中断'))})}
function storageFailure(error){$('saved').textContent='保存失败，请导出备份';toast('保存失败：'+(error?.message||'存储不可用'))}
function saveCurrentLibrary() {
 world.activeGroup=activeGroup;const current=maps.find(m=>m.id===mapId);if(current)current.world=world;
 if(!window.indexedDB){localStorage.setItem(LIBKEY,JSON.stringify({version:3,active:mapId,maps}));return Promise.resolve(true)}
 if(storageBooting)return storageReady.then(()=>saveCurrentLibrary());
 dirtyMapIds.add(mapId);
 const snapshots=maps.filter(m=>dirtyMapIds.has(m.id)).map(m=>({id:m.id,world:packImages(m.world)}));
 const snapshotGenerations=new Map(snapshots.map(m=>[m.id,mapGenerations.get(m.id)||0]));
 const present=new Set(maps.map(m=>m.id)),activeId=mapId;const deleted=[...removedMapIds].filter(id=>!present.has(id));
 for(const m of snapshots)dirtyMapIds.delete(m.id);for(const id of deleted)removedMapIds.delete(id);
 const trashSnapshots=[...pendingSceneTrash.values()];
 const resources=[...savedResources].filter(([id])=>!persistedResourceIds.has(id)).map(([id,image])=>({id,image}));
 saveQueue=saveQueue.catch(()=>{}).then(async()=>{
  if(!editorDatabase)throw Error('图片数据库尚未打开');
  const tx=editorDatabase.transaction(['maps','images','meta','versions'],'readwrite'),done=databaseTransaction(tx);
  for(const image of resources)tx.objectStore('images').put(image);
  for(const item of trashSnapshots)tx.objectStore('meta').put(item);
  for(const m of snapshots) {
   tx.objectStore('maps').put(m);
   tx.objectStore('versions').put({id:m.id+'-'+Date.now()+'-'+(++saveSerial),mapId:m.id,time:Date.now(),serial:saveSerial,world:m.world});
  }
  for(const id of deleted)tx.objectStore('maps').delete(id);
  tx.objectStore('meta').put({id:'library',active:activeId,order:[...present],version:3});
  await done;for(const item of trashSnapshots)if(pendingSceneTrash.get(item.id)===item)pendingSceneTrash.delete(item.id);for(const r of resources)persistedResourceIds.add(r.id);for(const [id,generation]of snapshotGenerations)savedMapGenerations.set(id,generation);for(const id of deleted)pendingDeletionJournal.delete(id);
  await trimVersions(snapshots.map(m=>m.id).concat(deleted));
  $('saved').textContent='● 已保存在本机';return true;
 }).catch(error=>{for(const m of snapshots)if(maps.some(a=>a.id===m.id))dirtyMapIds.add(m.id);for(const id of deleted)removedMapIds.add(id);storageFailure(error);return false});
 return saveQueue;
}
async function trimVersions(ids) {
 const tx=editorDatabase.transaction('versions','readwrite'),done=databaseTransaction(tx),store=tx.objectStore('versions');
 for(const id of new Set(ids)) {
  const items=await databaseRequest(store.index('mapId').getAll(id));
  for(const old of items.sort((a,b)=>b.time-a.time||b.serial-a.serial).slice(maps.some(m=>m.id===id)?3:0))store.delete(old.id);
 }
 await done;
}
async function initializeStorage() {
 if(!window.indexedDB)return;
 storageBooting=true;document.body.inert=true;$('saved').textContent='正在打开本机地图…';
 try {
  const request=indexedDB.open('atlas-editor-v3',2);
  request.onupgradeneeded=()=>{for(const name of ['maps','images','meta','versions'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name,{keyPath:'id'});const versions=request.transaction.objectStore('versions');if(!versions.indexNames.contains('mapId'))versions.createIndex('mapId','mapId')};
  editorDatabase=await databaseRequest(request);
  const tx=editorDatabase.transaction(['maps','images','meta'],'readonly');
  const [stored,resources,meta]=await Promise.all([databaseRequest(tx.objectStore('maps').getAll()),databaseRequest(tx.objectStore('images').getAll()),databaseRequest(tx.objectStore('meta').get('library'))]);
  for(const r of resources){savedResources.set(r.id,r.image);imageResourceIds.set(r.image,r.id);persistedResourceIds.add(r.id)}
  let recoveredJournal=false,effectiveMeta=meta;
  const journalRaw=localStorage.getItem('atlas-v3-journal');
  if(journalRaw)try {
   const journal=JSON.parse(journalRaw);
   if(!Array.isArray(journal.maps)||!Array.isArray(journal.order)||!Array.isArray(journal.deleted))throw Error('关闭前缓存格式无效');
   for(const r of journal.images||[]){if(!validTileImage(r.image))throw Error('关闭前图片缓存无效');savedResources.set(r.id,r.image);imageResourceIds.set(r.image,r.id)}
   for(const m of journal.maps)validate(unpackImages(m.world));
   for(const record of journal.trash||[]){validate(unpackImages(record.world));pendingSceneTrash.set(record.id,record)}
   const merged=new Map(stored.map(m=>[m.id,m]));
   for(const id of journal.deleted){merged.delete(id);removedMapIds.add(id)}
   for(const m of journal.maps){merged.set(m.id,m);dirtyMapIds.add(m.id)}
   stored.splice(0,stored.length,...merged.values());effectiveMeta={...(meta||{}),active:journal.active,order:journal.order};recoveredJournal=true;
  }catch(error){toast('关闭前缓存未能恢复，已继续读取数据库保存版本')}
  if(stored.length&&(effectiveMeta||recoveredJournal)) {
   const order=effectiveMeta?.order||stored.map(m=>m.id),byid=new Map(stored.map(m=>[m.id,m]));
   const restored=order.filter(id=>byid.has(id)).map(id=>({id,world:normalize(validate(unpackImages(byid.get(id).world)))}));
   if(!restored.length)throw Error('保存的地图列表为空');
   maps=restored;mapId=maps.some(m=>m.id===effectiveMeta?.active)?effectiveMeta.active:maps[0].id;world=maps.find(m=>m.id===mapId).world;
   history=[];future=[];pendingHistory=null;mapStates.clear();selected.clear();selectedRegion=null;active=world.types[0].id;activeGroup=world.activeGroup||'';
   roomDetail=null;roomOverviewView=null;resetTerrainIndex();applySceneDisplay();render();fit();$('saved').textContent='● 已保存在本机';
  } else for(const m of maps)dirtyMapIds.add(m.id);
 }catch(error){storageFailure(error)}
 finally{storageBooting=false}
 if(editorDatabase&&(dirtyMapIds.size||removedMapIds.size||pendingSceneTrash.size)){const saved=await saveCurrentLibrary();if(saved)localStorage.removeItem('atlas-v3-journal')}
 document.body.inert=false;
}
async function showRecoveryVersions() {
 await storageReady;await saveQueue;
 if(!editorDatabase)return toast('当前浏览器暂不支持恢复版本，请使用JSON备份');
 const records=await databaseRequest(editorDatabase.transaction('versions','readonly').objectStore('versions').index('mapId').getAll(mapId));
 const list=$('recoveryList');list.replaceChildren();
 for(const record of records.filter(v=>v.mapId===mapId).sort((a,b)=>b.time-a.time).slice(0,3)) {
  const button=document.createElement('button');button.type='button';button.textContent=new Date(record.time).toLocaleString('zh-CN')+' · 恢复';
  button.onclick=()=>{const restored=normalize(validate(unpackImages(record.world)));checkpoint();for(const k of Object.keys(world))delete world[k];Object.assign(world,restored);active=world.types[0].id;activeGroup=world.activeGroup||'';selected.clear();selectedRegion=null;changed();fit();$('recoveryDialog').close();toast('已恢复，可撤销')};
  list.append(button);
 }
 if(!list.childElementCount)list.textContent='暂无恢复版本';$('recoveryDialog').showModal();
}
let focusedCameraRoom=null,previewCell={x:0,y:0};
function isSolidType(type){return type?.solid===undefined?/方块|墙/.test(type?.name||''):type.solid}
function isHazardType(type){return type?.hazard===undefined?/尖刺|岩浆/.test(type?.name||''):type.hazard}
function focusCameraRoom(id) {
 focusedCameraRoom=id||null;const r=world.cameraRooms.find(r=>r.id===id);if(!r){syncCameraRoomInputs();return draw()}previewCell={x:Math.floor(r.x+r.w/2),y:Math.floor(r.y+r.h/2)};
 const scale=Math.min((W-50)/r.w,(H-50)/r.h);view.s=Math.max(1.2,Math.min(70,scale));view.x=W/2-(r.x+r.w/2)*view.s;view.y=H/2-(r.y+r.h/2)*view.s;
 syncCameraRoomInputs();if(cameraPreviewMode)updateCameraPreview();else draw();
}
function syncCameraRoomInputs() {
 const select=$('cameraSelect'),search=$('cameraSearch').value.trim().toLowerCase();select.replaceChildren();
 const all=document.createElement('option');all.value='';all.textContent='全图';select.append(all);
 for(const r of world.cameraRooms){if(search&&!r.name.toLowerCase().includes(search)&&r.id!==focusedCameraRoom)continue;const o=document.createElement('option');o.value=r.id;o.textContent=r.name;o.selected=r.id===focusedCameraRoom;select.append(o)}
 const r=world.cameraRooms.find(r=>r.id===focusedCameraRoom);$('cameraProperties').hidden=!r;
 if(r){$('cameraName').value=r.name;for(const k of ['x','y','w','h'])$('camera'+k.toUpperCase()).value=r[k];$('cameraMode').value=r.mode}
 $('cameraCount').textContent=world.cameraRooms.length+' 间';syncExitInputs();
}
function saveCameraRoom() {
 const r=world.cameraRooms.find(r=>r.id===focusedCameraRoom);if(!r)return;
 const candidate={...r,name:$('cameraName').value.trim()||'未命名房间',mode:$('cameraMode').value};
 for(const k of ['x','y','w','h'])candidate[k]=Number($('camera'+k.toUpperCase()).value);
 try{validateCameraRooms([candidate])}catch(error){return toast(error.message)}
 checkpoint();world.cameraRooms=world.cameraRooms.map(a=>a.id===r.id?candidate:a);changed();focusCameraRoom(r.id);
}
function autoConnectCameraRooms() {
 if(!world.cameraRooms.length)return toast('请先生成或创建镜头房间');
 const types=new Map(world.types.map(t=>[t.id,t]));
 const free=(x,y)=>!isSolidType(types.get(world.cells[key(x,y)]))&&!isHazardType(types.get(world.cells[key(x,y)]));
 const rooms=world.cameraRooms.map(r=>({...r,exits:[]}));let connections=0;
 for(let i=0;i<rooms.length;i++)for(let j=i+1;j<rooms.length;j++) {
  const a=rooms[i],b=rooms[j];let side,opposite,start,end;
  if(a.x+a.w===b.x||b.x+b.w===a.x){side=a.x+a.w===b.x?'right':'left';opposite=side==='right'?'left':'right';start=Math.max(a.y,b.y);end=Math.min(a.y+a.h,b.y+b.h)}
  else if(a.y+a.h===b.y||b.y+b.h===a.y){side=a.y+a.h===b.y?'bottom':'top';opposite=side==='bottom'?'top':'bottom';start=Math.max(a.x,b.x);end=Math.min(a.x+a.w,b.x+b.w)}
  else continue;
  let run=0,opening=null;
  for(let p=start;p<end;p++) {
   const vertical=side==='left'||side==='right';const boundary=vertical?(side==='right'?b.x:a.x):(side==='bottom'?b.y:a.y);
   const clear=vertical?free(boundary-1,p)&&free(boundary,p):free(p,boundary-1)&&free(p,boundary);
   run=clear?run+1:0;if(run>=2){opening=p-.5;break}
  }
  if(opening===null)continue;
  const vertical=side==='left'||side==='right';
  a.exits.push({to:b.id,side,offset:(opening-(vertical?a.y:a.x))/(vertical?a.h:a.w)});
  b.exits.push({to:a.id,side:opposite,offset:(opening-(vertical?b.y:b.x))/(vertical?b.h:b.w)});connections++;
 }
 checkpoint();world.cameraRooms=rooms;changed();toast('已更新 '+connections+' 组相邻出口，请用玩家尺度预览复核');
}
function findRoomIssues() {
 const results=[],types=new Map(world.types.map(t=>[t.id,t])),rooms=world.cameraRooms;
 const add=(message,x,y,room)=>results.push({message,x,y,room});
 for(const r of rooms) {
  for(const e of r.exits) {
   const target=rooms.find(a=>a.id===e.to),vertical=e.side==='left'||e.side==='right';
   const x=e.side==='left'?r.x:e.side==='right'?r.x+r.w-1:r.x+Math.floor(e.offset*r.w);
   const y=e.side==='top'?r.y:e.side==='bottom'?r.y+r.h-1:r.y+Math.floor(e.offset*r.h);
   if(!target||!target.exits.some(a=>a.to===r.id&&a.side===oppositeSides[e.side]))add(r.name+' 出口连接缺失',x,y,r.id);
   if(target){const adjacent=e.side==='left'?target.x+target.w===r.x:e.side==='right'?r.x+r.w===target.x:e.side==='top'?target.y+target.h===r.y:r.y+r.h===target.y;if(!adjacent)add(r.name+' 出口目标未相邻',x,y,r.id)}
   if(isSolidType(types.get(world.cells[key(x,y)])))add(r.name+' 出口被方块阻挡',x,y,r.id);
  }
  const roomCells=allTerrainEntries().filter(p=>inRect(p.x,p.y,r));
  const missing=new Set();for(const p of roomCells){const type=types.get(p.id);if(type?.autoPattern&&!world.tileArt[p.k]&&!missing.has(p.id)){missing.add(p.id);add(r.name+' 的'+type.name+'使用示意图案',p.x,p.y,r.id)}}
  for(const p of roomCells){const t=types.get(p.id);if(t?.name.includes('重生')&&isHazardType(types.get(world.cells[key(p.x,p.y+1)])))add(r.name+' 重生点下方有危险方块',p.x,p.y,r.id)}
 }
 const grouped=new Map();for(const[k,g]of Object.entries(world.members)){if(!grouped.has(g))grouped.set(g,[]);grouped.get(g).push(k)}
 for(const [g,keys]of grouped) {
  const type=types.get(world.cells[keys[0]]);if(!type||isSolidType(type))continue;
  const touched=new Set();for(const k of keys){const[x,y]=xy(k);for(const r of rooms)if(inRect(x,y,r))touched.add(r.id)}
  if(touched.size>1){const[x,y]=xy(keys[0]);add(type.name+' 整体跨越镜头边界',x,y,[...touched][0])}
  const areas=new Set();for(const k of keys){const[x,y]=xy(k);for(const r of world.regions)if(inRegion(x,y,r))areas.add(r.id)}if(areas.size>1){const[x,y]=xy(keys[0]);add(type.name+' 整体跨越玩法区域',x,y,null)}
 }
 for(const p of allTerrainEntries())if(!types.get(p.id))add('未匹配方块类型',p.x,p.y,null);
 const list=$('roomIssues');list.replaceChildren();
 for(const issue of results.slice(0,100)){const b=document.createElement('button');b.type='button';b.textContent=issue.message;b.onclick=()=>{if(issue.room)focusCameraRoom(issue.room);view.s=Math.max(view.s,16);view.x=W/2-(issue.x+.5)*view.s;view.y=H/2-(issue.y+.5)*view.s;previewCell={x:issue.x,y:issue.y};draw()};list.append(b)}
 if(!results.length)list.textContent='当前检查未发现出口连接、危险重生点或整体跨屏问题';else if(results.length>100){const p=document.createElement('p');p.textContent='共 '+results.length+' 处，先显示100处';list.append(p)}
 return results;
}
function drawCameraOverlay(s) {
 const focused=world.cameraRooms.find(r=>r.id===focusedCameraRoom);
 if(focused&&$('focusCamera').checked) {
  const l=-view.x,t=-view.y,right=W-view.x,bottom=H-view.y;
  const x=focused.x*s,y=focused.y*s,w=focused.w*s,h=focused.h*s;
  ctx.fillStyle='#071012b8';ctx.fillRect(l,t,right-l,Math.max(0,y-t));ctx.fillRect(l,y+h,right-l,Math.max(0,bottom-y-h));ctx.fillRect(l,y,Math.max(0,x-l),h);ctx.fillRect(x+w,y,Math.max(0,right-x-w),h);
 }
 if($('showCameraRooms').checked)for(const r of world.cameraRooms) {
  if(r.x*s+view.x>W||r.y*s+view.y>H||(r.x+r.w)*s+view.x<0||(r.y+r.h)*s+view.y<0)continue;
  ctx.strokeStyle=r===focused?'#fff0b2':'#f0c477';ctx.lineWidth=r===focused?2:1;ctx.strokeRect(r.x*s,r.y*s,r.w*s,r.h*s);
  ctx.fillStyle='#f0c477';ctx.font='11px sans-serif';ctx.fillText(r.name+(r.mode==='follow'?' · 跟随':''),r.x*s+4,r.y*s+14);
  for(const e of r.exits){const x=e.side==='left'?r.x:e.side==='right'?r.x+r.w:r.x+e.offset*r.w;const y=e.side==='top'?r.y:e.side==='bottom'?r.y+r.h:r.y+e.offset*r.h;ctx.fillStyle='#7ee9be';ctx.fillRect(x*s-3,y*s-3,6,6)}
 }
 if($('playerPreview').checked) {
  const x=previewCell.x,y=previewCell.y;ctx.strokeStyle='#f9e28b';ctx.fillStyle='#f9e28b55';ctx.fillRect(x*s,y*s,s,s);ctx.strokeRect(x*s,y*s,s,s);
  const duration=Number($('jumpDuration').value)||1.2;ctx.setLineDash([4,4]);
  for(const direction of [-1,1]){ctx.beginPath();for(let i=0;i<=40;i++){const t=i/40,px=(x+.5+direction*5*duration*t)*s,py=(y+.5-16*t*(1-t))*s;if(i)ctx.lineTo(px,py);else ctx.moveTo(px,py)}ctx.stroke()}
  ctx.setLineDash([]);
 }
}
let sidebarKeys={maps:'',groups:'',types:'',regions:''};
function sidebarKey(name,value){const text=JSON.stringify(value);const changed=sidebarKeys[name]!==text;sidebarKeys[name]=text;return changed}
function updatePerformanceStatus(ms) {
 const status=$('performanceStatus');if(status)status.textContent=Math.round(ms*10)/10+' ms · '+renderedTiles+' 可见格 · '+rasterChunks.size+' 缓存块';
}
function initializeEditorV2() {
 initializeRoomGridEditing();initializeRoomOperations();initializeShortcutManager();
 document.title='深图 ATLAS v2 · 房间关卡编辑器';
 const imageLabel=$('showArt').parentElement?.querySelector('span');if(imageLabel)imageLabel.textContent='显示方块图案';
 $('groupSearch').oninput=()=>{sidebarKeys.groups='';renderExtras()};
 $('cameraSearch').oninput=syncCameraRoomInputs;
 $('autoSplitRooms').onclick=()=>autoSplitRooms(false);$('splitRooms').onclick=()=>autoSplitRooms(true);
 $('resetRoomSize').onclick=()=>{$('roomWidth').value=32;$('roomHeight').value=18;$('roomWidth').onchange()};
 $('cameraSelect').onchange=e=>focusCameraRoom(e.target.value);
 $('cameraApply').onclick=saveCameraRoom;
 $('cameraAdd').onclick=()=>{const spec=validateRoomSpec(world.roomSpec),c=cell({x:W/2,y:H/2});checkpoint();const room={id:uid('camera'),name:'房间 '+(world.cameraRooms.length+1),x:Math.floor((c.x-spec.x)/spec.w)*spec.w+spec.x,y:Math.floor((c.y-spec.y)/spec.h)*spec.h+spec.y,w:spec.w,h:spec.h,mode:'fixed',exits:[]};world.cameraRooms=[...world.cameraRooms,room];changed();focusCameraRoom(room.id)};
 $('cameraDelete').onclick=()=>{if(!focusedCameraRoom)return;checkpoint();const id=focusedCameraRoom;world.cameraRooms=world.cameraRooms.filter(r=>r.id!==id).map(r=>({...r,exits:r.exits.filter(e=>e.to!==id)}));focusedCameraRoom=null;changed()};
 for(const [id,delta]of [['cameraPrev',-1],['cameraNext',1]])$(id).onclick=()=>{if(!world.cameraRooms.length)return;const i=world.cameraRooms.findIndex(r=>r.id===focusedCameraRoom);focusCameraRoom(world.cameraRooms[(i+delta+world.cameraRooms.length)%world.cameraRooms.length].id)};
 $('cameraPreview').onclick=toggleCameraPreview;$('exitAdd').onclick=addCameraExit;
 $('cameraConnect').onclick=autoConnectCameraRooms;$('cameraCheck').onclick=findRoomIssues;$('recover').onclick=()=>showRecoveryVersions().catch(storageFailure);
 for(const id of ['showCameraRooms','focusCamera','playerPreview','jumpDuration'])$(id).onchange=draw;
 window.addEventListener('keydown',e=>{if(!cameraPreviewMode||['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;if(e.key==='Escape'&&shortcutEnabled('escape')){toggleCameraPreview();e.preventDefault();e.stopImmediatePropagation();return}if(!shortcutEnabled('previewMove'))return;const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];if(!delta)return;e.preventDefault();e.stopImmediatePropagation();const r=world.cameraRooms.find(r=>r.id===focusedCameraRoom);if(!r)return;previewCell={x:Math.max(r.x,Math.min(r.x+r.w-1,previewCell.x+delta[0])),y:Math.max(r.y,Math.min(r.y+r.h-1,previewCell.y+delta[1]))};updateCameraPreview()},{capture:true});
 canvas.addEventListener('pointermove',e=>{if(cameraPreviewMode||!$('playerPreview').checked)return;const c=cell(point(e));if(c.x!==previewCell.x||c.y!==previewCell.y){previewCell=c;draw()}});
 syncCameraRoomInputs();
 window.addEventListener('beforeunload',writeClosingJournal);
 storageReady=initializeStorage();
}


function noteMapDirty() {
 if(!mapId)return;dirtyMapIds.add(mapId);mapGenerations.set(mapId,(mapGenerations.get(mapId)||0)+1);
}
function writeClosingJournal() {
 if(!window.indexedDB||storageBooting)return;
 const pending=maps.filter(m=>(mapGenerations.get(m.id)||0)!==(savedMapGenerations.get(m.id)||0)).map(m=>({id:m.id,world:packImages(m.world)}));
 if(!pending.length&&!pendingDeletionJournal.size&&!pendingSceneTrash.size)return;
 const ids=new Set();
 function collect(v){if(!v||typeof v!=='object')return;if(v.$image){ids.add(v.$image);return}for(const child of Object.values(v))collect(child)}
 for(const m of pending)collect(m.world);for(const record of pendingSceneTrash.values())collect(record.world);
 try{localStorage.setItem('atlas-v3-journal',JSON.stringify({maps:pending,trash:[...pendingSceneTrash.values()],active:mapId,order:maps.map(m=>m.id),deleted:[...pendingDeletionJournal],images:[...ids].filter(id=>!persistedResourceIds.has(id)).map(id=>({id,image:savedResources.get(id)}))}))}catch{storageFailure(Error('关闭前缓存写入失败，请使用导出备份'))}
}
let cameraPreviewMode=false;
const oppositeSides={left:'right',right:'left',top:'bottom',bottom:'top'};
function cameraPreviewViewport(room) {
 const spec=validateRoomSpec(world.roomSpec),w=room.mode==='follow'?Math.min(room.w,spec.w):room.w,h=room.mode==='follow'?Math.min(room.h,spec.h):room.h;
 const x=Math.max(room.x,Math.min(room.x+room.w-w,previewCell.x+.5-w/2));
 const y=Math.max(room.y,Math.min(room.y+room.h-h,previewCell.y+.5-h/2));
 return {x,y,w,h};
}
function updateCameraPreview() {
 const r=world.cameraRooms.find(r=>r.id===focusedCameraRoom);if(!r)return;
 const viewport=cameraPreviewViewport(r);view.s=Math.min((W-50)/viewport.w,(H-50)/viewport.h,70);view.s=Math.max(1.2,view.s);
 view.x=W/2-(viewport.x+viewport.w/2)*view.s;view.y=H/2-(viewport.y+viewport.h/2)*view.s;draw();
}
function toggleCameraPreview(){
 cameraPreviewMode=!cameraPreviewMode;
 if(cameraPreviewMode&&!focusedCameraRoom){cameraPreviewMode=false;return toast('先选择镜头房间')}
 $('cameraPreview').textContent=cameraPreviewMode?'退出镜头预览':'键盘镜头预览';
 if(cameraPreviewMode){$('playerPreview').checked=true;updateCameraPreview();toast('方向键移动1格参考玩家，Esc退出')}
}
function syncExitInputs(){
 const room=world.cameraRooms.find(r=>r.id===focusedCameraRoom),target=$('exitTarget'),list=$('exitList');target.replaceChildren();list.replaceChildren();
 for(const r of world.cameraRooms){if(r===room)continue;const o=document.createElement('option');o.value=r.id;o.textContent=r.name;target.append(o)}
 if(!room)return;
 for(const exit of room.exits){const row=document.createElement('div'),button=document.createElement('button');button.type='button';button.textContent=({left:'左',right:'右',top:'上',bottom:'下'})[exit.side]+' → '+(world.cameraRooms.find(r=>r.id===exit.to)?.name||'缺失房间')+' ×';button.onclick=()=>{checkpoint();world.cameraRooms=world.cameraRooms.map(r=>r.id===room.id?{...r,exits:r.exits.filter(e=>e!==exit)}:r.id===exit.to?{...r,exits:r.exits.filter(e=>!(e.to===room.id&&e.side===oppositeSides[exit.side]))}:r);changed()};row.append(button);list.append(row)}
}
function addCameraExit(){
 const room=world.cameraRooms.find(r=>r.id===focusedCameraRoom),target=world.cameraRooms.find(r=>r.id===$('exitTarget').value),side=$('exitSide').value,offset=Number($('exitOffset').value);
 if(!room||!target||!Number.isFinite(offset)||offset<0||offset>1)return toast('选择目标房间，出口位置需在0到1之间');
 const vertical=side==='left'||side==='right',position=(vertical?room.y:room.x)+offset*(vertical?room.h:room.w);
 const targetOffset=(position-(vertical?target.y:target.x))/(vertical?target.h:target.w);
 const adjacent=side==='left'?target.x+target.w===room.x:side==='right'?room.x+room.w===target.x:side==='top'?target.y+target.h===room.y:room.y+room.h===target.y;
 if(!adjacent||targetOffset<0||targetOffset>1)return toast('该出口位置未连接目标房间的相邻边');
 checkpoint();world.cameraRooms=world.cameraRooms.map(r=>r.id===room.id?{...r,exits:[...r.exits.filter(e=>!(e.to===target.id&&e.side===side)),{to:target.id,side,offset}]}:r.id===target.id?{...r,exits:[...r.exits.filter(e=>!(e.to===room.id&&e.side===oppositeSides[side])),{to:room.id,side:oppositeSides[side],offset:targetOffset}]}:r);changed();
}

function groupTileKeys(id){return [...(spatialIndex().groups.get(id)||[])]}
const regionTileCache=new WeakMap();
function regionTileKeys(r){
 const previous=regionTileCache.get(r);if(previous?.cells===world.cells&&previous.revision===terrainRevision)return previous.keys;
 const keys=[];
 for(const c of spatialIndex().chunks.values()){
  if(c.x>=r.x+r.w||c.y>=r.y+r.h||c.x+32<=r.x||c.y+32<=r.y)continue;
  for(const p of c.entries.values())if(inRegion(p.x,p.y,r))keys.push(p.k);
 }
 regionTileCache.set(r,{cells:world.cells,revision:terrainRevision,keys});return keys;
}

function autoSplitRooms(createCopy=false) {
 const spec={w:Number($('roomWidth').value),h:Number($('roomHeight').value),x:Number($('roomX').value),y:Number($('roomY').value),show:true,edit:!!world.roomSpec.edit};
 if(![spec.w,spec.h,spec.x,spec.y].every(Number.isInteger)||spec.w<8||spec.w>128||spec.h<8||spec.h>128||Math.abs(spec.x)>100000||Math.abs(spec.y)>100000)return toast('房间宽高需为8～128格整数，原点范围±100000');
 if(gesture)endGesture();
 if(createCopy){
  if(maps.length>=100)return toast('最多保存100张地图');
  const copy=clone(world);copy.title+=' · '+spec.w+'×'+spec.h+'房间网格';copy.roomSpec=spec;stash();const id=uid('map');maps.push({id,world:normalize(copy)});switchMap(id);
 }else{checkpoint();world.roomSpec=spec;roomDetail=null;roomOverviewView=null;changed()}
 syncRoomInputs();syncRoomDetailUI();fit();toast('背景房间网格已设为 '+spec.w+'×'+spec.h+' 格');
}

// Background room cells are virtual, including rooms that contain no tiles.
let roomDetail=null,roomOverviewView=null;
const sceneDisplayDefaults={grid:true,showArt:true,showRegions:true,showCameraRooms:false,showEmptyRegions:false,focusCamera:true,playerPreview:false};
function validateSceneDisplay(value){const source=value||{};return Object.fromEntries(Object.entries(sceneDisplayDefaults).map(([id,fallback])=>[id,typeof source[id]==='boolean'?source[id]:fallback]))}
function prepareRoomGrid(w){
 w.roomSpec=validateRoomSpec(w.roomSpec);w.roomNames=w.roomNames||{};
 if(w.roomGridVersion!==1){w.roomSpec.show=true;w.roomGridVersion=1}
 w.editorOptions=validateSceneDisplay(w.editorOptions);w.editorPerformance=validateScenePerformance(w.editorPerformance);
}
function validateScenePerformance(value){const v=value||{},r=v.restore;return {enabled:!!v.enabled,restore:r?{grid:!!r.grid,regions:!!r.regions,empty:!!r.empty}:null}}
function readSceneDisplay(){return Object.fromEntries(Object.keys(sceneDisplayDefaults).map(id=>[id,$(id).checked]))}
function applySceneDisplay(){
 world.editorOptions=validateSceneDisplay(world.editorOptions);const mode=validateScenePerformance(world.editorPerformance);performanceMode=mode.enabled;qualitySettings=mode.restore;$('optimize').textContent=performanceMode?'恢复完整显示':'性能优化';$('optimize').classList.toggle('active',performanceMode);
 for(const[id,value]of Object.entries(world.editorOptions))$(id).checked=value;
 syncRoomInputs();syncRoomDetailUI();
}
function backgroundRoomAt(x,y){
 const spec=validateRoomSpec(world.roomSpec),column=Math.floor((x-spec.x)/spec.w),row=Math.floor((y-spec.y)/spec.h);
 return {mapId,column,row,x:spec.x+column*spec.w,y:spec.y+row*spec.h,w:spec.w,h:spec.h};
}
function activeRoomDetail(){if(roomDetail?.mapId!==mapId)return null;const spec=validateRoomSpec(world.roomSpec);roomDetail={...roomDetail,x:spec.x+roomDetail.column*spec.w,y:spec.y+roomDetail.row*spec.h,w:spec.w,h:spec.h};return roomDetail}
function insideRoomDetail(x,y){const r=activeRoomDetail();return !r||inRect(x,y,r)}
function isRoomOverviewPicking(){return !!world.roomSpec?.edit&&!activeRoomDetail()}
function syncRoomDetailUI(){
 const r=activeRoomDetail(),enabled=!!world.roomSpec?.edit;
 $('roomBrowseMode').classList.toggle('active',enabled);$('roomBrowseMode').setAttribute?.('aria-pressed',String(enabled));
 $('roomBrowseMode').title=enabled?'房间编辑已开启：单击选择，双击细调':'开启房间编辑';
 $('roomDetailLabel').textContent=r?roomLabel(r)+' · '+r.w+'×'+r.h:enabled?'双击背景房间进入细调':'背景房间 '+world.roomSpec.w+'×'+world.roomSpec.h;
 $('exitRoomDetail').hidden=!r;syncRoomOperations();
}
function frameRoomDetail(){
 const r=activeRoomDetail();if(!r)return;
 view.s=Math.max(.15,Math.min(70,(W-70)/r.w,(H-70)/r.h));view.x=W/2-(r.x+r.w/2)*view.s;view.y=H/2-(r.y+r.h/2)*view.s;draw();
}
function enterRoomDetail(x,y){
 managedRoomSelection=backgroundRoomAt(x,y);
 if(!world.roomSpec.edit)return;
 if(gesture)endGesture();
 if(!activeRoomDetail())roomOverviewView={...view};
 roomDetail=backgroundRoomAt(x,y);selected.clear();selectedRegion=null;activeGroup='';focusedCameraRoom=null;cameraPreviewMode=false;
 $('cameraPreview').textContent='键盘镜头预览';render();syncRoomDetailUI();frameRoomDetail();
}
function exitRoomDetail(){
 if(gesture)endGesture();roomDetail=null;selected.clear();selectedRegion=null;
 if(roomOverviewView)view={...roomOverviewView};roomOverviewView=null;syncRoomDetailUI();render();draw();
}
function drawBackgroundRooms(s){
 const spec=validateRoomSpec(world.roomSpec);if(!spec.show&&!activeRoomDetail())return;
 const left=-view.x/s,top=-view.y/s,right=(W-view.x)/s,bottom=(H-view.y)/s;
 const firstColumn=Math.floor((left-spec.x)/spec.w),lastColumn=Math.floor((right-spec.x)/spec.w),firstRow=Math.floor((top-spec.y)/spec.h),lastRow=Math.floor((bottom-spec.y)/spec.h);
 ctx.save();ctx.strokeStyle='#a7d8c5bb';ctx.lineWidth=1.7;ctx.beginPath();
 for(let column=firstColumn;column<=lastColumn+1;column++){const x=(spec.x+column*spec.w)*s;ctx.moveTo(x,top*s);ctx.lineTo(x,bottom*s)}
 for(let row=firstRow;row<=lastRow+1;row++){const y=(spec.y+row*spec.h)*s;ctx.moveTo(left*s,y);ctx.lineTo(right*s,y)}ctx.stroke();
 if(spec.w*s>=120&&spec.h*s>=80){ctx.fillStyle='#b2d5c6';ctx.font='11px sans-serif';for(let row=firstRow;row<=lastRow;row++)for(let column=firstColumn;column<=lastColumn;column++){const x=(spec.x+column*spec.w)*s,y=(spec.y+row*spec.h)*s;if(x>=left*s&&y>=top*s)ctx.fillText(roomLabel({column,row}),x+7,y+17,Math.max(20,spec.w*s-14))}}
 ctx.restore();
}
function drawRoomDetailOverlay(s){
 const r=activeRoomDetail();if(!r)return;
 const left=-view.x,top=-view.y,right=W-view.x,bottom=H-view.y,x=r.x*s,y=r.y*s,w=r.w*s,h=r.h*s;
 ctx.save();ctx.fillStyle='#071012d9';ctx.fillRect(left,top,right-left,Math.max(0,y-top));ctx.fillRect(left,y+h,right-left,Math.max(0,bottom-y-h));ctx.fillRect(left,y,Math.max(0,x-left),h);ctx.fillRect(x+w,y,Math.max(0,right-x-w),h);
 ctx.strokeStyle='#c4f0d7';ctx.lineWidth=2;ctx.strokeRect(x,y,w,h);ctx.restore();
}
function initializeRoomGridEditing(){
 applySceneDisplay();
 $('roomBrowseMode').onclick=()=>{
  if(gesture)endGesture();const enabled=!world.roomSpec.edit;
  if(!enabled&&activeRoomDetail())exitRoomDetail();
  world.roomSpec={...world.roomSpec,edit:enabled,show:true};selected.clear();selectedRegion=null;syncRoomInputs();syncRoomDetailUI();persist();draw();
 };
 $('exitRoomDetail').onclick=exitRoomDetail;
 for(const id of Object.keys(sceneDisplayDefaults)){
  const previous=$(id).onchange;
  $(id).onchange=e=>{if(previous)previous(e);world.editorOptions=readSceneDisplay();persist()};
 }

}
function regionWithinRoomDetail(r){const detail=activeRoomDetail();return !detail||(r.x>=detail.x&&r.y>=detail.y&&r.x+r.w<=detail.x+detail.w&&r.y+r.h<=detail.y+detail.h)}
function fitBackgroundBounds(b){
 const spec=validateRoomSpec(world.roomSpec);if(!spec.show)return b;
 const x=spec.x+Math.floor((b.x-spec.x)/spec.w)*spec.w,y=spec.y+Math.floor((b.y-spec.y)/spec.h)*spec.h;
 const right=spec.x+Math.ceil((b.x+b.w-spec.x)/spec.w)*spec.w,bottom=spec.y+Math.ceil((b.y+b.h-spec.y)/spec.h)*spec.h;
 return {x,y,w:Math.max(spec.w,right-x),h:Math.max(spec.h,bottom-y)};
}
function overviewMap(){if(activeRoomDetail())exitRoomDetail();fit()}

function archiveSceneToTrash(id,scene){
 const record={id:'trash:'+id,sceneId:id,time:Date.now(),world:window.indexedDB?packImages(scene):clone(scene)};
 if(window.indexedDB){pendingSceneTrash.set(record.id,record);return}
 const records=JSON.parse(localStorage.getItem('atlas-scene-trash-v1')||'[]');records.push(record);localStorage.setItem('atlas-scene-trash-v1',JSON.stringify(records));
}
async function getSceneTrash(){
 await storageReady;await saveQueue;
 if(!window.indexedDB)return JSON.parse(localStorage.getItem('atlas-scene-trash-v1')||'[]');
 if(!editorDatabase)throw Error('本机数据库不可用');
 const records=await databaseRequest(editorDatabase.transaction('meta','readonly').objectStore('meta').getAll());
 return records.filter(r=>r.id.startsWith('trash:')).sort((a,b)=>b.time-a.time);
}
async function restoreSceneFromTrash(record){
 if(maps.length>=100)throw Error('最多保存100张场景');
 const restored=normalize(validate(window.indexedDB?unpackImages(record.world):record.world));
 stash();const id=uid('map');maps.push({id,world:restored});dirtyMapIds.add(id);switchMap(id);
 if(!await saveLibrary())throw Error('恢复未完成，请先导出当前场景备份');
 if(editorDatabase){const tx=editorDatabase.transaction('meta','readwrite'),done=databaseTransaction(tx);tx.objectStore('meta').delete(record.id);await done}
 else{const records=JSON.parse(localStorage.getItem('atlas-scene-trash-v1')||'[]');localStorage.setItem('atlas-scene-trash-v1',JSON.stringify(records.filter(r=>r.id!==record.id)))}
 toast('场景已恢复');
}
