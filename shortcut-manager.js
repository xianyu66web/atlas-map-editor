'use strict';
const shortcutDefinitions = [
 {id:'draw',keys:'B',label:'自由绘制'},
 {id:'rect',keys:'G',label:'矩形填充'},
 {id:'erase',keys:'E',label:'擦除方块'},
 {id:'select',keys:'V',label:'框选'},
 {id:'region',keys:'R',label:'区域工具'},
 {id:'pan',keys:'H',label:'平移画布'},
 {id:'middlePan',keys:'鼠标中键拖动',label:'平移画布'},
 {id:'rightSelect',keys:'右键点击 → 左键拖动',label:'选择整体，再拖动搬移'},
 {id:'ctrlErase',keys:'Ctrl＋拖动',label:'连续擦除；G工具中矩形擦除'},
 {id:'pickType',keys:'Alt＋点击',label:'吸取方块类型'},
 {id:'addSelection',keys:'Shift＋框选',label:'临时选择时追加选区'},
 {id:'newGroup',keys:'Shift / Shift＋点击',label:'切换整体或新建整体'},
 {id:'cut',keys:'Ctrl X',label:'剪切方块选区'},
 {id:'copy',keys:'Ctrl C',label:'复制选区；房间总览中复制房间'},
 {id:'paste',keys:'Ctrl V',label:'粘贴选区；房间总览中粘贴房间'},
 {id:'undo',keys:'Ctrl Z',label:'撤销'},
 {id:'redoShift',keys:'Ctrl Shift Z',label:'重做'},
 {id:'redoY',keys:'Ctrl Y',label:'重做'},
 {id:'save',keys:'Ctrl S',label:'导出当前地图 JSON'},
 {id:'selectAll',keys:'Ctrl A',label:'选择当前编辑范围内全部方块'},
 {id:'delete',keys:'Delete / Backspace',label:'删除选区；房间总览中打开房间删除选项'},
 {id:'overview',keys:'F',label:'总览地图'},
 {id:'escape',keys:'Esc',label:'取消选择或退出房间细调'},
 {id:'help',keys:'?',label:'打开快捷键管理器'},
 {id:'wheelZoom',keys:'鼠标滚轮',label:'围绕指针缩放画布'},
 {id:'roomDrag',keys:'左键拖动房间',label:'房间总览中交换房间'},
 {id:'roomDetail',keys:'双击房间',label:'进入房间细调'},
 {id:'regionEdit',keys:'双击区域',label:'编辑区域属性'},
 {id:'typeEdit',keys:'双击方块库项目',label:'编辑方块类型'},
 {id:'previewMove',keys:'方向键',label:'键盘镜头预览中移动参考玩家'},
 {id:'panelMove',keys:'面板标题上按方向键',label:'移动浮动面板（Shift加速）'},
 {id:'panelResize',keys:'缩放柄上按方向键',label:'调整浮动面板宽高'},
 {id:'panelCollapse',keys:'双击面板标题 / Enter',label:'折叠或展开浮动面板'}
];
const shortcutStorageKey = 'atlas-shortcuts-v1';
let shortcutSettings = {};
try { const saved=JSON.parse(localStorage.getItem(shortcutStorageKey)||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))shortcutSettings=saved; } catch {}
function shortcutEnabled(id) { return shortcutSettings[id] !== false; }
function shortcutTextTarget(target) { return ['INPUT','TEXTAREA','SELECT'].includes(target?.tagName)||!!target?.isContentEditable; }
function setShortcutEnabled(id,enabled) {
 shortcutSettings[id]=!!enabled;
 if(id==='rightSelect'&&!enabled&&temporarySelect)endGesture();
 if(id==='newGroup'&&!enabled)shiftArmed=false;
 try { localStorage.setItem(shortcutStorageKey,JSON.stringify(shortcutSettings)); }
 catch { toast('快捷键设置暂存于当前窗口'); }
}
function openShortcutManager() {
 const list=$('shortcutList');list.replaceChildren();
 for(const definition of shortcutDefinitions) {
  const row=document.createElement('label');row.className='shortcut-row';
  const keys=document.createElement('kbd');keys.textContent=definition.keys;
  const description=document.createElement('span');description.textContent=definition.label;
  const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=shortcutEnabled(definition.id);
  checkbox.dataset.shortcut=definition.id;checkbox.setAttribute('aria-label',definition.label);
  checkbox.onchange=()=>setShortcutEnabled(definition.id,checkbox.checked);
  row.append(keys,description,checkbox);list.append(row);
 }
 $('shortcutDialog').showModal();
}
function cancelEditorAction() {
 if(gesture&&['draw','erase'].includes(gesture.kind))endGesture();
 else {gesture=null;temporarySelect=false;}
 shiftArmed=false;selected.clear();selectedRegion=null;
 if(activeRoomDetail())exitRoomDetail();else {render();draw();}
}
function handleEditorKeydown(e) {
 if(shortcutTextTarget(e.target)||document.querySelector('dialog[open]'))return;
 const keyName=e.key.toLowerCase();
 if(keyName==='shift'&&!e.repeat&&!e.ctrlKey&&!e.metaKey&&shortcutEnabled('newGroup')) {
  shiftArmed=!shiftArmed;toast(shiftArmed?'点击已有整体切换；点击空白处新建整体':'已取消整体切换');return;
 }
 if(e.ctrlKey||e.metaKey) {
  const commands={x:['cut',cut],c:['copy',copy],v:['paste',paste],y:['redoY',redo],s:['save',()=>$('export').click()],a:['selectAll',()=>{selected=new Set(Object.keys(world.cells).filter(k=>insideRoomDetail(...xy(k))));setTool('select');render();draw();}]};
  if(keyName==='z') {
   const id=e.shiftKey?'redoShift':'undo';if(shortcutEnabled(id)){e.preventDefault();e.shiftKey?redo():undo();}return;
  }
  const command=commands[keyName];if(command&&shortcutEnabled(command[0])){e.preventDefault();command[1]();}return;
 }
 if(keyName==='escape'&&shortcutEnabled('escape')){e.preventDefault();cancelEditorAction();return;}
 if(['delete','backspace'].includes(keyName)&&shortcutEnabled('delete')){e.preventDefault();remove();return;}
 const tools={b:['draw','draw'],g:['rect','rect'],e:['erase','erase'],v:['select','select'],r:['region','region'],h:['pan','pan']};
 const action=tools[keyName];if(action&&shortcutEnabled(action[0]))setTool(action[1]);
 if(keyName==='f'&&shortcutEnabled('overview'))overviewMap();
 if(keyName==='?'&&shortcutEnabled('help'))openShortcutManager();
}
function initializeShortcutManager() {
 $('shortcutManager').onclick=openShortcutManager;$('help').onclick=openShortcutManager;
 for(const [id,enabled]of [['shortcutsOn',true],['shortcutsOff',false]])$(id).onclick=()=>{
  for(const definition of shortcutDefinitions)setShortcutEnabled(definition.id,enabled);
  $('shortcutDialog').close();openShortcutManager();
 };
}
