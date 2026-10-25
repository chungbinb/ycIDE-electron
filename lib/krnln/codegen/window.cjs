// 系统核心支持库的窗口与组件语义（设计稿 §6.6、§11 阶段 2 遗留①）：
// 组件属性名与默认值、窗口属性、事件名及其 Win32 消息映射、组件方法（画板绘图、选择列表框、选择夹、超级链接框）的翻译。
// 编译器只按字段名、函数名调用这里，不再含有核心库组件的中文属性名、事件名。
// 只有随安装包发布的内置支持库目录里的脚本会被加载（脚本在编译器进程里执行）。
// 由 src/main/compiler.ts 原有实现原样迁移；改动后运行 tests/unit/controlCodegenSnapshot.spec.ts 核对生成结果。
'use strict'

function escapeCString(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}
// 设计器属性值容错读取：属性面板存布尔/数字，但手工编辑的 .efw 可能是 '真'/'假'/数字字符串
function readBoolProp(value, def) {
  if (value === undefined || value === null)
    return def;
  if (typeof value === 'boolean')
    return value;
  if (value === '真' || value === 'true' || value === 1)
    return true;
  if (value === '假' || value === 'false' || value === 0)
    return false;
  return def;
}
function readIntProp(value, def) {
  if (typeof value === 'number' && Number.isFinite(value))
    return Math.trunc(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim()))
    return Number.parseInt(value.trim(), 10);
  return def;
}
// 从 .efw 的 properties 字典读取窗口属性（编辑器内存与磁盘解析两条路径共用）
function applyWindowProperties(info, p) {
  if (p['可视'] === false)
    info.visible = false;
  if (p['禁止'] === true)
    info.disabled = true;
  if (typeof p['边框'] === 'number')
    info.border = p['边框'];
  // 兼容简体"钮"（设计器内存路径与 window-units.json 用简体）与历史繁体"鈕"，
  // 否则关闭标签页后按磁盘 .efw 编译时这几个属性被忽略、与标签开着时行为不一致。
  if (p['最大化按钮'] === false || p['最大化按鈕'] === false)
    info.maxButton = false;
  if (p['最小化按钮'] === false || p['最小化按鈕'] === false)
    info.minButton = false;
  if (p['控制按钮'] === false || p['控制按鈕'] === false)
    info.controlBox = false;
  if (p['总在最前'] === true)
    info.topmost = true;
  if (typeof p['位置'] === 'number')
    info.startPos = p['位置'];
  if (typeof p['左边'] === 'number')
    info.left = p['左边'];
  if (typeof p['顶边'] === 'number')
    info.top = p['顶边'];
  if (typeof p['底色'] === 'number')
    info.backColor = p['底色'];
  if (typeof p['鼠标指针'] === 'number')
    info.mousePointer = p['鼠标指针'];
  if (p['可否移动'] === false)
    info.movable = false;
  if (p['回车下移焦点'] === true)
    info.enterAsTab = true;
  if (p['Esc键关闭'] === true)
    info.escClose = true;
  if (p['在任务条中显示'] === false)
    info.showInTaskbar = false;
  if (p['随意移动'] === true)
    info.dragMove = true;
  if (p['保持标题条激活'] === true)
    info.keepCaptionActive = true;
  if (typeof p['窗口类名'] === 'string' && p['窗口类名'].trim() !== '')
    info.wndClassName = p['窗口类名'].trim();
  if (typeof p['外形'] === 'number' && p['外形'] >= 0 && p['外形'] <= 2)
    info.shape = p['外形'];
  if (typeof p['圆角半径'] === 'number' && p['圆角半径'] >= 0)
    info.cornerRadius = p['圆角半径'];
  if (typeof p['底图'] === 'string' && p['底图'].startsWith('data:image'))
    info.backImage = p['底图'];
  if (typeof p['底图方式'] === 'number' && p['底图方式'] >= 0 && p['底图方式'] <= 4)
    info.backImageMode = p['底图方式'];
  if (typeof p['图标'] === 'string' && p['图标'].startsWith('data:image'))
    info.iconImage = p['图标'];
}
// 鼠标指针枚举 → Win32 系统光标（15 自定义型暂按默认箭头处理）
const MOUSE_POINTER_CURSOR_IDS = [
  'IDC_ARROW', 'IDC_ARROW', 'IDC_CROSS', 'IDC_IBEAM', 'IDC_WAIT', 'IDC_HELP',
  'IDC_APPSTARTING', 'IDC_NO', 'IDC_SIZEALL', 'IDC_UPARROW', 'IDC_SIZENS',
  'IDC_SIZEWE', 'IDC_SIZENWSE', 'IDC_SIZENESW', 'IDC_HAND', 'IDC_ARROW',
];
function resolveCommandNotifyCode(className, eventName) {
  const cls = (className || '').toUpperCase();
  const ev = (eventName || '').replace(/\s+/g, '');
  const isClick = ev.includes('被单击') || ev === '单击' || ev === '点击';
  const isDblClick = ev.includes('双击');
  const isTextChange = ev.includes('内容被改变') || ev.includes('内容改变') || ev.includes('文本被改变') || ev.includes('文本改变');
  const isSelectChange = ev.includes('选择项被改变') || ev.includes('选择被改变') || ev.includes('选中项被改变') || ev.includes('选中被改变');
  const isFocus = ev.includes('得到焦点');
  const isBlur = ev.includes('失去焦点');
  if (isClick) {
    if (cls === 'BUTTON' || cls === 'YCBUTTON')
      return 'BN_CLICKED';
    if (cls === 'STATIC')
      return 'STN_CLICKED';
  }
  if (isDblClick) {
    if (cls === 'BUTTON' || cls === 'YCBUTTON')
      return 'BN_DBLCLK';
    if (cls === 'STATIC')
      return 'STN_DBLCLK';
    if (cls === 'LISTBOX')
      return 'LBN_DBLCLK';
  }
  if (isTextChange) {
    if (cls === 'EDIT')
      return 'EN_CHANGE';
    if (cls === 'COMBOBOX')
      return 'CBN_EDITCHANGE';
  }
  if (isSelectChange) {
    if (cls === 'LISTBOX')
      return 'LBN_SELCHANGE';
    if (cls === 'COMBOBOX')
      return 'CBN_SELCHANGE';
  }
  if (isFocus) {
    if (cls === 'EDIT')
      return 'EN_SETFOCUS';
    if (cls === 'LISTBOX')
      return 'LBN_SETFOCUS';
    if (cls === 'COMBOBOX')
      return 'CBN_SETFOCUS';
    if (cls === 'BUTTON' || cls === 'YCBUTTON')
      return 'BN_SETFOCUS';
  }
  if (isBlur) {
    if (cls === 'EDIT')
      return 'EN_KILLFOCUS';
    if (cls === 'LISTBOX')
      return 'LBN_KILLFOCUS';
    if (cls === 'COMBOBOX')
      return 'CBN_KILLFOCUS';
    if (cls === 'BUTTON' || cls === 'YCBUTTON')
      return 'BN_KILLFOCUS';
  }
  return null;
}
function resolveNotifyCode(className, eventName) {
  const cls = (className || '').toUpperCase();
  const ev = (eventName || '').replace(/\s+/g, '');
  const isClick = ev.includes('被单击') || ev === '单击' || ev === '点击';
  const isDblClick = ev.includes('双击');
  const isSelectChange = ev.includes('选择项被改变') || ev.includes('选择被改变') || ev.includes('选中项被改变') || ev.includes('选中被改变');
  const isItemActivate = ev.includes('项被激活') || ev.includes('激活项');
  const isLabelBegin = ev.includes('开始标签编辑') || ev.includes('开始编辑标签');
  const isLabelEnd = ev.includes('结束标签编辑') || ev.includes('标签编辑结束');
  const isExpandCollapse = ev.includes('展开') || ev.includes('折叠');
  const isCustomDraw = ev.includes('自定义绘制') || ev.includes('绘制');
  if (cls === 'SYSLISTVIEW32') {
    if (isClick)
      return 'NM_CLICK';
    if (isDblClick)
      return 'NM_DBLCLK';
    if (isSelectChange)
      return 'LVN_ITEMCHANGED';
    if (isItemActivate)
      return 'LVN_ITEMACTIVATE';
    if (isLabelBegin)
      return 'LVN_BEGINLABELEDIT';
    if (isLabelEnd)
      return 'LVN_ENDLABELEDIT';
    if (isCustomDraw)
      return 'NM_CUSTOMDRAW';
  }
  if (cls === 'SYSTREEVIEW32') {
    if (isClick)
      return 'NM_CLICK';
    if (isDblClick)
      return 'NM_DBLCLK';
    if (isSelectChange)
      return 'TVN_SELCHANGED';
    if (isLabelBegin)
      return 'TVN_BEGINLABELEDIT';
    if (isLabelEnd)
      return 'TVN_ENDLABELEDIT';
    if (isExpandCollapse)
      return 'TVN_ITEMEXPANDED';
    if (isCustomDraw)
      return 'NM_CUSTOMDRAW';
  }
  if (cls === 'SYSTABCONTROL32') {
    if (isSelectChange)
      return 'TCN_SELCHANGE';
    if (isClick)
      return 'NM_CLICK';
    if (isDblClick)
      return 'NM_DBLCLK';
  }
  return null;
}
function resolveScrollMessage(className, eventName) {
  const cls = (className || '').toUpperCase();
  const ev = (eventName || '').replace(/\s+/g, '');
  const isScrollLike = ev.includes('滚动') || ev.includes('位置') || ev.includes('值被改变') || ev.includes('值改变');
  if (!isScrollLike)
    return null;
  if (cls === 'MSCTLS_TRACKBAR32')
    return 'WM_HSCROLL';
  if (cls === 'SCROLLBAR')
    return 'WM_HSCROLL';
  return null;
}
// 组合框/列表框/选择列表框 项目成员方法名（这些名字对控件是专属的，用作 名.方法(参数) 的运行时派发判据）。
const LISTLIKE_METHOD_NAMES = new Set([
  '跳转', // 超级链接框：按类型 ShellExecute 打开邮件/网址
  '是否被选中', '选中项目', '是否被允许', '允许', // 选择列表框：勾选/允许状态
  '取子夹数目', '取子夹名称', '置子夹名称', // 选择夹
  // 画板绘图方法（名称与上面各控件不重叠，故共用派发不冲突）
  '取设备句柄', '清除', '取点', '画点', '画直线', '画椭圆', '画弧线', '画弦', '画饼',
  '画矩形', '画渐变矩形', '填充矩形', '画圆角矩形', '翻转矩形区', '画多边形',
  '置写出位置', '写文本行', '滚动写行', '写出', '定位写出', '取宽度', '取高度',
  '画图片', '取图片宽度', '取图片高度', '复制', '取图片', '单位转换',
]);
// 把 组合框1.加入项目("x", 5) 之类的控件项目成员方法调用译成 yc_ll_*/yc_lb_* 运行时助手调用。
// tx = 递归翻译参数表达式的回调。返回 null 表示不是此类调用（交回主流程）。
function translateListLikeMethodCall(call, tx) {
  const dot = call.name.lastIndexOf('.');
  if (dot <= 0)
    return null;
  const objName = call.name.slice(0, dot);
  const method = call.name.slice(dot + 1);
  if (!LISTLIKE_METHOD_NAMES.has(method))
    return null;
  if (!/^[一-龥㐀-䶿가-힣぀-ヿA-Za-z_][一-龥㐀-䶿가-힣぀-ヿA-Za-z0-9_]*$/.test(objName))
    return null;
  const args = call.args || [];
  const nm = `L"${escapeCString(objName)}"`;
  const A = (i) => tx(args[i] ?? '0');
  switch (method) {
    // 组合框/列表框 项目方法已全部走声明式协议（controlMethodBindings→krnln_ll_*/krnln_lb_*），旧路不再兜底。
    case '跳转': return `yc_hyperlink_jump(${nm})`;
    case '是否被选中': return `yc_chk_is_checked(${nm}, ${A(0)})`;
    case '选中项目': return `yc_chk_set_checked(${nm}, ${A(0)}, ${args.length > 1 ? A(1) : '1'})`;
    case '是否被允许': return `yc_chk_is_enabled(${nm}, ${A(0)})`;
    case '允许': return `yc_chk_enable(${nm}, ${A(0)}, ${args.length > 1 ? A(1) : '1'})`;
    case '取子夹数目': return `yc_tab_count(${nm})`;
    case '取子夹名称': return `yc_tab_get_name(${nm}, ${A(0)})`;
    case '置子夹名称': return `yc_tab_set_name(${nm}, ${A(0)}, ${A(1)})`;
    // ===== 画板绘图方法（省略参数用 (-2147483647-1)=INT_MIN 哨兵；通用型文本参数经 yc_value_to_text 转文本）=====
    case '取设备句柄': return `yc_dp_gethdc(${nm})`;
    case '清除': return `yc_dp_cls(${nm}, ${args.length > 0 ? A(0) : '0'}, ${args.length > 1 ? A(1) : '0'}, ${args.length > 2 ? A(2) : '0'}, ${args.length > 3 ? A(3) : '0'})`;
    case '取点': return `yc_dp_getpixel(${nm}, ${A(0)}, ${A(1)})`;
    case '画点': return `yc_dp_setpixel(${nm}, ${A(0)}, ${A(1)}, ${A(2)})`;
    case '画直线': return `yc_dp_line(${nm}, ${A(0)}, ${A(1)}, ${A(2)}, ${A(3)})`;
    case '画椭圆': return `yc_dp_ellipse(${nm}, ${A(0)}, ${A(1)}, ${A(2)}, ${A(3)})`;
    case '画弧线': return `yc_dp_arc(${nm}, ${A(0)}, ${A(1)}, ${A(2)}, ${A(3)}, ${A(4)}, ${A(5)}, ${A(6)}, ${A(7)})`;
    case '画弦': return `yc_dp_chord(${nm}, ${A(0)}, ${A(1)}, ${A(2)}, ${A(3)}, ${A(4)}, ${A(5)}, ${A(6)}, ${A(7)})`;
    case '画饼': return `yc_dp_pie(${nm}, ${A(0)}, ${A(1)}, ${A(2)}, ${A(3)}, ${A(4)}, ${A(5)}, ${A(6)}, ${A(7)})`;
    case '画矩形': return `yc_dp_rect(${nm}, ${A(0)}, ${A(1)}, ${A(2)}, ${A(3)})`;
    case '画渐变矩形': return args.length >= 7
      ? `yc_dp_gradrect(${nm}, ${A(0)}, ${A(1)}, ${A(2)}, ${A(3)}, ${A(4)}, ${A(5)}, ${A(6)})`
      : `yc_dp_gradrect(${nm}, ${A(0)}, ${A(1)}, ${A(2)}, ${A(3)}, 2, ${A(4)}, ${A(5)})`;
    case '填充矩形': return `yc_dp_fillrect(${nm}, ${A(0)}, ${A(1)}, ${A(2)}, ${A(3)})`;
    case '画圆角矩形': return `yc_dp_roundrect(${nm}, ${A(0)}, ${A(1)}, ${A(2)}, ${A(3)}, ${A(4)}, ${args.length > 5 ? A(5) : '(-2147483647-1)'})`;
    case '翻转矩形区': return `yc_dp_invert(${nm}, ${A(0)}, ${A(1)}, ${A(2)}, ${A(3)})`;
    case '画多边形': return `yc_dp_polygon(${nm}, ${A(0)}, ${args.length > 1 ? A(1) : '0'})`;
    case '置写出位置': return `yc_dp_setwritepos(${nm}, ${args.length > 0 ? A(0) : '(-2147483647-1)'}, ${args.length > 1 ? A(1) : '(-2147483647-1)'})`;
    case '写文本行': return `yc_dp_print(${nm}, ${args.length > 0 ? `yc_value_to_text(${A(0)})` : 'L""'})`;
    case '滚动写行': return `yc_dp_sprint(${nm}, ${args.length > 0 ? `yc_value_to_text(${A(0)})` : 'L""'})`;
    case '写出': return `yc_dp_writeout(${nm}, ${args.length > 0 ? `yc_value_to_text(${A(0)})` : 'L""'})`;
    case '定位写出': return `yc_dp_say(${nm}, ${args.length > 0 ? A(0) : '(-2147483647-1)'}, ${args.length > 1 ? A(1) : '(-2147483647-1)'}, ${args.length > 2 ? `yc_value_to_text(${A(2)})` : 'L""'})`;
    case '取宽度': return `yc_dp_getwidth(${nm}, yc_value_to_text(${A(0)}))`;
    case '取高度': return `yc_dp_getheight(${nm}, yc_value_to_text(${A(0)}))`;
    case '画图片': return `yc_dp_drawpic(${nm}, ${A(0)}, ${A(1)}, ${A(2)}, ${args.length > 3 ? A(3) : '0'}, ${args.length > 4 ? A(4) : '0'}, ${args.length > 5 ? A(5) : '0'})`;
    case '取图片宽度': return `yc_dp_getpicwidth(${nm}, ${A(0)})`;
    case '取图片高度': return `yc_dp_getpicheight(${nm}, ${A(0)})`;
    case '复制': return `yc_dp_copy(${nm})`;
    case '取图片': return `yc_dp_getpic(${nm}, ${args.length > 0 ? A(0) : '0'}, ${args.length > 1 ? A(1) : '0'})`;
    case '单位转换': return `yc_dp_unitcnv(${nm}, ${A(0)}, ${A(1)})`;
    default: return null;
  }
}

// 组件属性 → 编译器使用的语义字段（属性名与默认值都在这里定义，编译器只认字段名）
function props(p) {
  p = p || {}
  const text = (name) => String(p[name] ?? '')
  return {
    backColor: readIntProp(p['底色'], 0),
    font: p['字体'],
    shape: readIntProp(p['外形'], 0),
    lineEffect: readIntProp(p['线条效果'], 0),
    lineStyle: readIntProp(p['线型'], 1),
    lineWidth: readIntProp(p['线宽'], 1),
    lineColor: readIntProp(p['线条颜色'], 0),
    fillColor: readIntProp(p['填充颜色'], 0xffffff),
    backgroundColor: readIntProp(p['背景颜色'], 0xffffff),
    gradientMode: readIntProp(p['渐变背景方式'], 0),
    gradientColor1: readIntProp(p['渐变背景颜色1'], 0),
    gradientColor2: readIntProp(p['渐变背景颜色2'], 0),
    gradientColor3: readIntProp(p['渐变背景颜色3'], 0),
    backImageMode: readIntProp(p['底图方式'], 0),
    hAlign: readIntProp(p['横向对齐方式'], 1),
    vAlign: readIntProp(p['纵向对齐方式'], 1),
    kind: readIntProp(p['类型'], 0),
    email: text('电子邮件地址'),
    url: text('Internet地址'),
    lineStep: readIntProp(p['行改变值'], 1),
    pageStep: readIntProp(p['页改变值'], 10),
    tabOwner: typeof p['所属选择夹'] === 'string' ? String(p['所属选择夹']) : '',
    tabPage: readIntProp(p['所属子夹'], 0),
    timerInterval: readIntProp(p['时钟周期'], 0),
    checked: readBoolProp(p['选中'], false),
    transparentColor: readIntProp(p['透明颜色'], -1),
    currentTab: readIntProp(p['现行子夹'], 0),
    tabTitles: text('子夹标题'),
    hideSelf: readBoolProp(p['隐藏自身'], false),
    displayMode: readIntProp(p['显示方式'], 0),
    penStyle: readIntProp(p['画笔类型'], 1),
    penWidth: readIntProp(p['画笔粗细'], 0),
    penColor: readIntProp(p['画笔颜色'], 0),
    drawMode: readIntProp(p['画出方式'], 12),
    brushStyle: readIntProp(p['刷子类型'], 1),
    brushColor: readIntProp(p['刷子颜色'], 16777215),
    textColor: readIntProp(p['文本颜色'], 0),
    textBackColor: readIntProp(p['文本背景颜色'], 16777215),
    drawUnit: readIntProp(p['绘画单位'], 0),
    autoRedraw: readBoolProp(p['自动重画'], false),
    panelBackColor: readIntProp(p['画板背景色'], 16777215),
    tabOrder: readIntProp(p['停留顺序'], 0),
    disabled: p['禁止'] === true,
    picture: p['图片'],
    backImage: p['底图'],
  }
}

// 组件初始文本取自哪个属性（标题类组件；是否回退到组件名由编译器按特征决定）
function captionText(p) {
  return p['标题'] || p['内容'] || p['文本'] || p['地址'] || p['title'] || p['text']
}

// 编译器生成事件处理函数（弱实现、派发表）时用到的核心库事件名
function eventNames() {
  return {
    windowCreated: '创建完毕',
    windowKeyDown: '按下某键',
    windowKeyUp: '某键被放开',
    windowResized: '窗口尺寸被改变',
    windowClosing: '即将被销毁',
    menuSelected: '被选择',
    windowMoved: '被移动',
    windowActivated: '被激活',
    windowFocus: '得到焦点',
    windowBlur: '失去焦点',
    windowDestroyed: '被销毁',
    click: '被单击',
    paint: '绘画',
    timerTick: '周期事件',
    mouseXY: ['鼠标左键被按下', '鼠标左键被放开', '被双击', '鼠标右键被按下', '鼠标右键被放开', '鼠标位置被移动'],
    wheel: '滚轮被滚动',
  }
}

function mousePointerCursor(index) {
  return MOUSE_POINTER_CURSOR_IDS[index] || 'IDC_ARROW'
}

exports.controlCodegen = {
  props,
  captionText,
  eventNames,
  mousePointerCursor,
  windowProperties: (p, info) => applyWindowProperties(info, p || {}),
  commandNotifyCode: resolveCommandNotifyCode,
  notifyCode: resolveNotifyCode,
  scrollMessage: resolveScrollMessage,
  controlMethodCall: translateListLikeMethodCall,
}
