// 系统核心支持库的组件代码生成脚本（设计稿 §6.6、§11 阶段 2 遗留①）。
// 编译器按控件特征（control-traits.json）调用这里的函数，把设计器里的组件属性落成 Win32 创建样式位、
// 扩展样式与创建后的消息；编译器本身不再含有任何组件的代码生成细节。
// 只有随安装包发布的内置支持库目录里的脚本会被加载（脚本在编译器进程里执行）。
// 由 src/main/compiler.ts 原有实现原样迁移；改动后运行 tests/unit/controlCodegenSnapshot.spec.ts 核对生成结果。
'use strict'

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
// 控件「边框」6 路映射到 exStyle（0无/1凹入CLIENTEDGE/2凸出WINDOWEDGE/3浅凹STATICEDGE/4镜框DLGMODALFRAME；5单线走 style 的 WS_BORDER）。
function ctrlBorderExStyle(border) {
  return border === 1 ? 'WS_EX_CLIENTEDGE'
    : border === 2 ? 'WS_EX_WINDOWEDGE'
      : border === 3 ? 'WS_EX_STATICEDGE'
        : border === 4 ? 'WS_EX_DLGMODALFRAME'
          : '0';
}
function escapeCString(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}
// 标准 EDIT 控件不走 WCM_SETPROP 协议（Win32 原生类忽略 WM_APP+1），
// 编辑框属性必须在创建时落成样式位，创建后用 EM_* 消息补齐动态属性。
// 各属性默认值必须与 lib/krnln/window-units.json 编辑框定义中的 defaultValue 保持一致。
function buildStdEditCodegen(extraProps) {
  const border = readIntProp(extraProps['边框'], 1);
  const multiline = readBoolProp(extraProps['是否允许多行'], false);
  const scroll = readIntProp(extraProps['滚动条'], 0);
  const align = readIntProp(extraProps['对齐方式'], 0);
  const inputMode = readIntProp(extraProps['输入方式'], 0);
  const caseConvert = readIntProp(extraProps['转换方式'], 0);
  const hideSelection = readBoolProp(extraProps['隐藏选择'], true);
  const tabStop = readBoolProp(extraProps['可停留焦点'], true);
  const maxLen = readIntProp(extraProps['最大允许长度'], 0);
  const selStart = readIntProp(extraProps['起始选择位置'], 0);
  const selLength = readIntProp(extraProps['被选择字符数'], 0);
  const spinMode = readIntProp(extraProps['调节器方式'], 0);
  const spinMin = readIntProp(extraProps['调节器底限值'], 0);
  const spinMax = readIntProp(extraProps['调节器上限值'], 100);
  const passwordChar = String(extraProps['密码遮盖字符'] ?? '*');
  const textColor = readIntProp(extraProps['文本颜色'], 0);
  const backColor = readIntProp(extraProps['背景颜色'], 0xffffff);
  const parts = ['WS_CHILD'];
  if (tabStop)
    parts.push('WS_TABSTOP');
  if (multiline) {
    parts.push('ES_MULTILINE', 'ES_AUTOVSCROLL', 'ES_WANTRETURN');
  }
  else {
    parts.push('ES_AUTOHSCROLL');
  }
  if (scroll === 1 || scroll === 3)
    parts.push('WS_HSCROLL');
  if (scroll === 2 || scroll === 3)
    parts.push('WS_VSCROLL');
  if (align === 1)
    parts.push('ES_CENTER');
  else if (align === 2)
    parts.push('ES_RIGHT');
  // 输入方式：0通常 1只读方式 2密码输入 3整数文本 4小数文本 5字节 6短整数 7整数 8长整数 9小数 10双精度 11日期时间
  if (inputMode === 1)
    parts.push('ES_READONLY');
  if (inputMode === 2)
    parts.push('ES_PASSWORD');
  // 转换方式（与易语言 ConvertMode 索引一致）：1=大写->小写(强制小写) 2=小写->大写(强制大写)
  if (caseConvert === 1)
    parts.push('ES_LOWERCASE');
  else if (caseConvert === 2)
    parts.push('ES_UPPERCASE');
  if (!hideSelection)
    parts.push('ES_NOHIDESEL');
  // 边框（与易语言 EditBox.border 索引一致）：0无 1凹入式 2凸出式 3浅凹入式 4镜框式 5单线边框式
  if (border === 5)
    parts.push('WS_BORDER');
  const postCreateLines = [];
  if (maxLen > 0) {
    postCreateLines.push(`SendMessage(hCtrl, EM_LIMITTEXT, ${maxLen}, 0);`);
  }
  if (inputMode === 2) {
    const maskCodePoint = passwordChar.codePointAt(0) ?? 42;
    if (maskCodePoint !== 42) {
      postCreateLines.push(`SendMessage(hCtrl, EM_SETPASSWORDCHAR, ${maskCodePoint}, 0);`);
    }
  }
  const needsInputFilter = inputMode >= 3 && inputMode <= 11;
  if (needsInputFilter) {
    postCreateLines.push(`SetWindowSubclass(hCtrl, YcEditInputFilterProc, 1, (DWORD_PTR)${inputMode});`);
  }
  if (selStart > 0 || selLength > 0) {
    postCreateLines.push(`SendMessage(hCtrl, EM_SETSEL, ${Math.max(selStart, 0)}, ${Math.max(selStart, 0) + Math.max(selLength, 0)});`);
  }
  if (spinMode === 1 || spinMode === 2) {
    // 自动调节器(1)：UDS_SETBUDDYINT 让上下键在上/下限内自动增减编辑框整数内容 + 设范围；
    // 手动调节器(2)：不绑整数、不设范围，仅贴附编辑框，由程序在 WM_VSCROLL 事件里自行处理。
    const budInt = spinMode === 1 ? ' | UDS_SETBUDDYINT' : '';
    const rangeMsg = spinMode === 1 ? ` SendMessage(hSpin, UDM_SETRANGE32, (WPARAM)${spinMin}, (LPARAM)${spinMax});` : '';
    postCreateLines.push(`{ HWND hSpin = CreateWindowExW(0, L"msctls_updown32", L"", WS_CHILD | WS_VISIBLE${budInt} | UDS_ALIGNRIGHT | UDS_ARROWKEYS | UDS_NOTHOUSANDS, 0, 0, 0, 0, hWndParent, NULL, g_hInstance, NULL);`
      + ' SendMessage(hSpin, UDM_SETBUDDY, (WPARAM)hCtrl, 0);'
      + rangeMsg + ' }');
  }
  return {
    exStyle: border === 1 ? 'WS_EX_CLIENTEDGE'
      : border === 2 ? 'WS_EX_WINDOWEDGE'
        : border === 3 ? 'WS_EX_STATICEDGE'
          : border === 4 ? 'WS_EX_DLGMODALFRAME'
            : '0',
    style: parts.join(' | '),
    postCreateLines,
    colorEntry: (textColor !== 0 || backColor !== 0xffffff) ? { textColor, backColor } : null,
    needsInputFilter,
  };
}
// 标准 STATIC 标签：横/纵对齐落成 SS_* 样式位、边框走 exStyle（与编辑框同 6 路映射 + 渐变镜框式）、
// 文本/背景色与透明经 WM_CTLCOLORSTATIC 查表（复用 g_ycEditColors）。字体走通用 CreateFontW 路径。
// 底图/底图方式/数据源/数据列暂声明占位（需 owner-draw/数据绑定，待后续）。
function buildStdLabelCodegen(extraProps) {
  const hAlign = readIntProp(extraProps['横向对齐方式'], 0); // 0左 1中 2右
  const vAlign = readIntProp(extraProps['纵向对齐方式'], 0); // 0顶 1中 2底
  const border = readIntProp(extraProps['边框'], 0); // 0无 1凹入 2凸出 3浅凹 4镜框 5单线 6渐变镜框
  const effect = readIntProp(extraProps['效果'], 0); // 0通常 1凹入 2凸出 3阴影 4透明
  const textColor = readIntProp(extraProps['文本颜色'], 0);
  const backColor = readIntProp(extraProps['背景颜色'], 16777215); // 默认白色（进颜色表填白，创建即白底不再融入窗口）；-1 兼容旧工程=融入窗口；0=纯黑；显式白/黑=真白/真黑
  const autoWrap = readBoolProp(extraProps['是否自动折行'], false);
  const parts = ['WS_CHILD', 'SS_NOTIFY'];
  // 横向对齐：居中/右总是折行；左对齐时按「是否自动折行」选 SS_LEFT(折行)/SS_LEFTNOWORDWRAP(不折行)
  parts.push(hAlign === 1 ? 'SS_CENTER' : hAlign === 2 ? 'SS_RIGHT' : (autoWrap ? 'SS_LEFT' : 'SS_LEFTNOWORDWRAP'));
  if (vAlign === 1)
    parts.push('SS_CENTERIMAGE'); // STATIC 仅支持垂直居中（单行）
  if (border === 5)
    parts.push('WS_BORDER');
  const exStyle = border === 1 ? 'WS_EX_CLIENTEDGE'
    : border === 2 ? 'WS_EX_WINDOWEDGE'
      : border === 3 ? 'WS_EX_STATICEDGE'
        : (border === 4 || border === 6) ? 'WS_EX_DLGMODALFRAME'
          : '0';
  return {
    style: parts.join(' | '),
    exStyle,
    colorEntry: (textColor !== 0 || backColor >= 0) ? { textColor, backColor: backColor >= 0 ? backColor : 0xffffff } : null,
    transparent: effect === 4,
  };
}
// 标准 BUTTON·选择框(BS_AUTOCHECKBOX)/单选框(BS_AUTORADIOBUTTON)：勾选/按钮形式/平面/标题居左/对齐落成样式，
// 选中态创建后 BM_SETCHECK。文本/背景色经 WM_CTLCOLORSTATIC（复用 g_ycEditColors），字体走通用路径。
// 图片/数据源/数据列暂声明占位。
function buildStdCheckableCodegen(extraProps, isRadio) {
  const hAlign = readIntProp(extraProps['横向对齐方式'], 0); // 0左 1中 2右
  const vAlign = readIntProp(extraProps['纵向对齐方式'], 0); // 0顶 1中 2底
  const pushLike = readBoolProp(extraProps['按钮形式'], false);
  const flat = readBoolProp(extraProps['平面'], false);
  const leftText = readBoolProp(extraProps['标题居左'], false);
  const checked = readBoolProp(extraProps['选中'], false);
  const textColor = readIntProp(extraProps['文本颜色'], 0);
  const backColor = readIntProp(extraProps['背景颜色'], 16777215); // 默认白色（进颜色表填白，创建即白底不再融入窗口）；-1 兼容旧工程=融入窗口；0=纯黑；显式白/黑=真白/真黑
  const parts = ['WS_CHILD', 'WS_TABSTOP', isRadio ? 'BS_AUTORADIOBUTTON' : 'BS_AUTOCHECKBOX'];
  if (pushLike)
    parts.push('BS_PUSHLIKE');
  if (flat)
    parts.push('BS_FLAT');
  if (leftText)
    parts.push('BS_LEFTTEXT'); // 标题居左（勾选框移到右侧）
  parts.push(hAlign === 1 ? 'BS_CENTER' : hAlign === 2 ? 'BS_RIGHT' : 'BS_LEFT');
  parts.push(vAlign === 1 ? 'BS_VCENTER' : vAlign === 2 ? 'BS_BOTTOM' : 'BS_TOP');
  return {
    style: parts.join(' | '),
    checked,
    colorEntry: (textColor !== 0 || backColor >= 0) ? { textColor, backColor: backColor >= 0 ? backColor : 0xffffff } : null,
  };
}
// 标准 BUTTON·分组框(BS_GROUPBOX)：标题对齐落成样式，文本/背景色经 WM_CTLCOLORSTATIC，字体走通用路径。
function buildStdGroupBoxCodegen(extraProps) {
  const hAlign = readIntProp(extraProps['对齐方式'], 0); // 0左 1中 2右
  const textColor = readIntProp(extraProps['文本颜色'], 0);
  const backColor = readIntProp(extraProps['背景颜色'], 16777215); // 默认白色（进颜色表填白，创建即白底不再融入窗口）；-1 兼容旧工程=融入窗口；0=纯黑；显式白/黑=真白/真黑
  const parts = ['WS_CHILD', 'BS_GROUPBOX'];
  parts.push(hAlign === 1 ? 'BS_CENTER' : hAlign === 2 ? 'BS_RIGHT' : 'BS_LEFT');
  return {
    style: parts.join(' | '),
    colorEntry: (textColor !== 0 || backColor >= 0) ? { textColor, backColor: backColor >= 0 ? backColor : 0xffffff } : null,
  };
}
// 标准 STATIC·图片框：边框走 exStyle，背景色经 WM_CTLCOLORSTATIC；有图片则 SS_BITMAP + SS_REALSIZECONTROL
// + 创建后 STM_SETIMAGE。显示方式=居中→SS_CENTERIMAGE；=缩放→STM_SETIMAGE 前把位图拉伸到控件客户区（见图片赋值处）。
// SS_REALSIZECONTROL 关键：不加则 SS_BITMAP 会把控件放大到图片原始尺寸（运行后图片框异常变大），加了才保持设计尺寸。
function buildStdPicBoxCodegen(extraProps, hasImage) {
  const border = readIntProp(extraProps['边框'], 0); // 0无 1凹入 2凸出 3浅凹 4镜框 5单线
  const drawMode = readIntProp(extraProps['显示方式'], 0); // 0居左上 1缩放 2居中
  const backColor = readIntProp(extraProps['背景颜色'], 0xffffff);
  const parts = ['WS_CHILD', 'SS_NOTIFY'];
  if (hasImage)
    parts.push('SS_BITMAP', 'SS_REALSIZECONTROL'); // REALSIZECONTROL：控件不随位图自动放大，恒守设计尺寸
  if (drawMode === 2)
    parts.push('SS_CENTERIMAGE'); // 图片居中（真实尺寸居中，裁剪）
  const exStyle = border === 1 ? 'WS_EX_CLIENTEDGE'
    : border === 2 ? 'WS_EX_WINDOWEDGE'
      : border === 3 ? 'WS_EX_STATICEDGE'
        : border === 4 ? 'WS_EX_DLGMODALFRAME'
          : '0';
  if (border === 5)
    parts.push('WS_BORDER');
  return {
    style: parts.join(' | '),
    exStyle,
    // 图片框是实底控件：背景色恒经 WM_CTLCOLORSTATIC 上色（含白色），否则 STATIC 会透出父窗口背景。
    colorEntry: { textColor: 0, backColor },
  };
}
// 进度条（msctls_progress32）：方向/显示方式→样式位，边框→exStyle，范围/位置→PBM_ 消息。
function buildStdProgressCodegen(extraProps) {
  const orient = readIntProp(extraProps['方向'], 0); // 0横 1纵
  const drawMode = readIntProp(extraProps['显示方式'], 0); // 0分块 1连续
  const border = readIntProp(extraProps['边框'], 1);
  const minPos = readIntProp(extraProps['最小位置'], 0);
  const maxPos = readIntProp(extraProps['最大位置'], 100);
  const pos = readIntProp(extraProps['位置'], 0);
  const parts = ['WS_CHILD'];
  if (orient === 1)
    parts.push('PBS_VERTICAL');
  if (drawMode === 1)
    parts.push('PBS_SMOOTH');
  if (border === 5)
    parts.push('WS_BORDER');
  const post = [];
  if (minPos !== 0 || maxPos !== 100)
    post.push(`SendMessage(hCtrl, PBM_SETRANGE32, (WPARAM)${minPos}, (LPARAM)${maxPos});`);
  if (pos !== 0)
    post.push(`SendMessage(hCtrl, PBM_SETPOS, (WPARAM)${pos}, 0);`);
  return { style: parts.join(' | '), exStyle: ctrlBorderExStyle(border), postCreateLines: post, colorEntry: null };
}
// 画板（自注册 YCDRAWPANEL 类）：边框→style/exStyle。无 WS_TABSTOP（画板只有绘画事件、无焦点输入）；
// 运行时状态/backbuffer/绘画事件由 YcDrawPanelProc + g_ycDrawPanels 负责（见 CreateControls 前的画板运行时块）。
function buildStdDrawPanelCodegen(extraProps) {
  const border = readIntProp(extraProps['边框'], 0);
  const parts = ['WS_CHILD', 'WS_CLIPSIBLINGS'];
  if (border === 5)
    parts.push('WS_BORDER');
  return { style: parts.join(' | '), exStyle: ctrlBorderExStyle(border), postCreateLines: [], colorEntry: null };
}
// 滑块条（msctls_trackbar32）：方向/刻度类型/允许选择→样式位，范围/刻度/页行/选区/位置→TBM_ 消息。
function buildStdSliderCodegen(extraProps) {
  const orient = readIntProp(extraProps['方向'], 0);
  const tick = readIntProp(extraProps['刻度类型'], 2); // 0无 1上左 2下右 3双向
  const tickFreq = readIntProp(extraProps['单位刻度值'], 1);
  const allowSel = readBoolProp(extraProps['允许选择'], false);
  const selStart = readIntProp(extraProps['首选择位置'], 0);
  const selLen = readIntProp(extraProps['选择长度'], 0);
  const pageChange = readIntProp(extraProps['页改变值'], 0);
  const lineChange = readIntProp(extraProps['行改变值'], 0);
  const minPos = readIntProp(extraProps['最小位置'], 0);
  const maxPos = readIntProp(extraProps['最大位置'], 100);
  const pos = readIntProp(extraProps['位置'], 0);
  const border = readIntProp(extraProps['边框'], 0);
  const parts = ['WS_CHILD', 'WS_TABSTOP'];
  parts.push(orient === 1 ? 'TBS_VERT' : 'TBS_HORZ');
  if (tick === 0)
    parts.push('TBS_NOTICKS');
  else {
    parts.push('TBS_AUTOTICKS');
    if (tick === 1)
      parts.push('TBS_TOP');
    else if (tick === 3)
      parts.push('TBS_BOTH');
  }
  if (allowSel)
    parts.push('TBS_ENABLESELRANGE');
  if (border === 5)
    parts.push('WS_BORDER');
  const post = [];
  post.push(`SendMessage(hCtrl, TBM_SETRANGEMIN, (WPARAM)TRUE, (LPARAM)${minPos});`);
  post.push(`SendMessage(hCtrl, TBM_SETRANGEMAX, (WPARAM)TRUE, (LPARAM)${maxPos});`);
  if (tick !== 0 && tickFreq > 0)
    post.push(`SendMessage(hCtrl, TBM_SETTICFREQ, (WPARAM)${tickFreq}, 0);`);
  if (pageChange > 0)
    post.push(`SendMessage(hCtrl, TBM_SETPAGESIZE, 0, (LPARAM)${pageChange});`);
  if (lineChange > 0)
    post.push(`SendMessage(hCtrl, TBM_SETLINESIZE, 0, (LPARAM)${lineChange});`);
  if (allowSel && selLen > 0)
    post.push(`SendMessage(hCtrl, TBM_SETSEL, (WPARAM)TRUE, (LPARAM)MAKELONG(${selStart}, ${selStart + selLen}));`);
  if (pos !== 0)
    post.push(`SendMessage(hCtrl, TBM_SETPOS, (WPARAM)TRUE, (LPARAM)${pos});`);
  return { style: parts.join(' | '), exStyle: ctrlBorderExStyle(border), postCreateLines: post, colorEntry: null };
}
// 滚动条（SCROLLBAR）：SBS_HORZ/VERT，范围+页+位置→SetScrollInfo。跟随/事件门控在 WM_?SCROLL 处理器（未在此实现，静态范围/位置已生效）。
function buildStdScrollBarCodegen(extraProps, isVert) {
  const minPos = readIntProp(extraProps['最小位置'], 0);
  const maxPos = readIntProp(extraProps['最大位置'], 100);
  const pageChange = readIntProp(extraProps['页改变值'], 10);
  const pos = readIntProp(extraProps['位置'], 0);
  const post = [
    `{ SCROLLINFO si; ZeroMemory(&si, sizeof(si)); si.cbSize = sizeof(si); si.fMask = SIF_RANGE | SIF_PAGE | SIF_POS; si.nMin = ${minPos}; si.nMax = ${maxPos}; si.nPage = ${Math.max(0, pageChange)}; si.nPos = ${pos}; SetScrollInfo(hCtrl, SB_CTL, &si, TRUE); }`,
  ];
  return { style: `WS_CHILD | ${isVert ? 'SBS_VERT' : 'SBS_HORZ'}`, exStyle: '0', postCreateLines: post, colorEntry: null };
}
// 日期框（SysDateTimePick32）：允许编辑/附件类型/边框→样式位/exStyle。今天/最小/最大日期缺文本→SYSTEMTIME 解析，暂占位。
function buildStdDatePickerCodegen(extraProps) {
  const allowEdit = readBoolProp(extraProps['允许编辑'], false);
  const kind = readIntProp(extraProps['附件类型'], 0); // 0下拉月历 1调节器
  const border = readIntProp(extraProps['边框'], 0);
  const parts = ['WS_CHILD', 'WS_TABSTOP'];
  if (allowEdit)
    parts.push('DTS_APPCANPARSE');
  if (kind === 1)
    parts.push('DTS_UPDOWN');
  if (border === 5)
    parts.push('WS_BORDER');
  const today = String(extraProps['今天'] ?? '');
  const minDate = String(extraProps['最小日期'] ?? '');
  const maxDate = String(extraProps['最大日期'] ?? '');
  const post = [];
  if (today)
    post.push(`{ SYSTEMTIME st; if (yc_parse_systemtime(L"${escapeCString(today)}", &st)) SendMessage(hCtrl, DTM_SETSYSTEMTIME, GDT_VALID, (LPARAM)&st); }`);
  if (minDate || maxDate) {
    const setMin = minDate ? `if (yc_parse_systemtime(L"${escapeCString(minDate)}", &r[0])) f |= GDTR_MIN;` : '';
    const setMax = maxDate ? `if (yc_parse_systemtime(L"${escapeCString(maxDate)}", &r[1])) f |= GDTR_MAX;` : '';
    post.push(`{ SYSTEMTIME r[2]; ZeroMemory(r, sizeof(r)); DWORD f = 0; ${setMin} ${setMax} if (f) SendMessage(hCtrl, DTM_SETRANGE, (WPARAM)f, (LPARAM)r); }`);
  }
  return { style: parts.join(' | '), exStyle: ctrlBorderExStyle(border), postCreateLines: post, colorEntry: null };
}
// 月历（SysMonthCal32）：显示项样式位 + 首日/滚动月/最多选天→MCM_ 消息 + 颜色→MCM_SETCOLOR。日期属性暂占位。
function buildStdMonthCalCodegen(extraProps) {
  const border = readIntProp(extraProps['边框'], 0);
  const noToday = readBoolProp(extraProps['不显示今天'], false);
  const noTodayCircle = readBoolProp(extraProps['不圈注今天'], false);
  const weekNumbers = readBoolProp(extraProps['显示星期序号'], false);
  const multiSel = readBoolProp(extraProps['允许选择多天'], false);
  const firstDay = readIntProp(extraProps['开始星期首日'], 0);
  const monthDelta = readIntProp(extraProps['滚动月数'], 0);
  const maxSel = readIntProp(extraProps['最多选择天数'], 0);
  const parts = ['WS_CHILD'];
  if (noToday)
    parts.push('MCS_NOTODAY');
  if (noTodayCircle)
    parts.push('MCS_NOTODAYCIRCLE');
  if (weekNumbers)
    parts.push('MCS_WEEKNUMBERS');
  if (multiSel)
    parts.push('MCS_MULTISELECT');
  if (border === 5)
    parts.push('WS_BORDER');
  const post = [];
  if (firstDay !== 0)
    post.push(`SendMessage(hCtrl, MCM_SETFIRSTDAYOFWEEK, 0, (LPARAM)${firstDay});`);
  if (monthDelta > 0)
    post.push(`SendMessage(hCtrl, MCM_SETMONTHDELTA, (WPARAM)${monthDelta}, 0);`);
  if (multiSel && maxSel > 0)
    post.push(`SendMessage(hCtrl, MCM_SETMAXSELCOUNT, (WPARAM)${maxSel}, 0);`);
  const colorMap = [
    ['文本颜色', 'MCSC_TEXT', 0], ['背景颜色', 'MCSC_BACKGROUND', 0xffffff], ['标题颜色', 'MCSC_TITLETEXT', 0],
    ['标题背景颜色', 'MCSC_TITLEBK', 0], ['内背景颜色', 'MCSC_MONTHBK', 0xffffff], ['非本月颜色', 'MCSC_TRAILINGTEXT', 0],
  ];
  for (const [prop, macro, def] of colorMap) {
    const v = readIntProp(extraProps[prop], def);
    if (v !== def)
      post.push(`SendMessage(hCtrl, MCM_SETCOLOR, ${macro}, (LPARAM)(COLORREF)${v >>> 0});`);
  }
  // 日期属性（今天/最小/最大日期/首尾选择日）经 yc_parse_systemtime 解析 → MCM_ 消息。
  const today = String(extraProps['今天'] ?? '');
  const minDate = String(extraProps['最小日期'] ?? '');
  const maxDate = String(extraProps['最大日期'] ?? '');
  const minSel = String(extraProps['首选择日'] ?? '');
  const maxSel2 = String(extraProps['尾选择日'] ?? '');
  if (today)
    post.push(`{ SYSTEMTIME st; if (yc_parse_systemtime(L"${escapeCString(today)}", &st)) SendMessage(hCtrl, MCM_SETTODAY, 0, (LPARAM)&st); }`);
  if (minDate || maxDate) {
    const setMin = minDate ? `if (yc_parse_systemtime(L"${escapeCString(minDate)}", &r[0])) f |= GDTR_MIN;` : '';
    const setMax = maxDate ? `if (yc_parse_systemtime(L"${escapeCString(maxDate)}", &r[1])) f |= GDTR_MAX;` : '';
    post.push(`{ SYSTEMTIME r[2]; ZeroMemory(r, sizeof(r)); DWORD f = 0; ${setMin} ${setMax} if (f) SendMessage(hCtrl, MCM_SETRANGE, (WPARAM)f, (LPARAM)r); }`);
  }
  if (multiSel && minSel && maxSel2) {
    post.push(`{ SYSTEMTIME r[2]; ZeroMemory(r, sizeof(r)); if (yc_parse_systemtime(L"${escapeCString(minSel)}", &r[0]) && yc_parse_systemtime(L"${escapeCString(maxSel2)}", &r[1])) SendMessage(hCtrl, MCM_SETSELRANGE, 0, (LPARAM)r); }`);
  }
  else if (!multiSel && minSel) {
    post.push(`{ SYSTEMTIME st; if (yc_parse_systemtime(L"${escapeCString(minSel)}", &st)) SendMessage(hCtrl, MCM_SETCURSEL, 0, (LPARAM)&st); }`);
  }
  return { style: parts.join(' | '), exStyle: ctrlBorderExStyle(border), postCreateLines: post, colorEntry: null };
}
// 组合框（COMBOBOX）：类型→CBS_SIMPLE/DROPDOWN/DROPDOWNLIST，自动排序→CBS_SORT；内容/长度/选中→CB_ 消息；文本/背景色→颜色表。
function buildStdComboBoxCodegen(extraProps) {
  const kind = readIntProp(extraProps['类型'], 2); // 0可编辑列表 1可编辑下拉 2不可编辑下拉
  const sort = readBoolProp(extraProps['自动排序'], false);
  const maxLen = readIntProp(extraProps['最大文本长度'], 0);
  const curSel = readIntProp(extraProps['现行选中项'], -1);
  const content = String(extraProps['内容'] ?? '');
  const textColor = readIntProp(extraProps['文本颜色'], 0);
  const backColor = readIntProp(extraProps['背景颜色'], 0xffffff);
  const parts = ['WS_CHILD', 'WS_TABSTOP', 'WS_VSCROLL', 'CBS_HASSTRINGS'];
  parts.push(kind === 0 ? 'CBS_SIMPLE' : kind === 1 ? 'CBS_DROPDOWN' : 'CBS_DROPDOWNLIST');
  if (sort)
    parts.push('CBS_SORT');
  const post = [];
  if (content && kind !== 2)
    post.push(`SetWindowTextW(hCtrl, L"${escapeCString(content)}");`);
  if (maxLen > 0 && kind !== 2)
    post.push(`SendMessage(hCtrl, CB_LIMITTEXT, (WPARAM)${maxLen}, 0);`);
  if (curSel >= 0)
    post.push(`SendMessage(hCtrl, CB_SETCURSEL, (WPARAM)${curSel}, 0);`);
  return { style: parts.join(' | '), exStyle: '0', postCreateLines: post, colorEntry: (textColor !== 0 || backColor !== 0xffffff) ? { textColor, backColor } : null };
}
// 列表框/选择列表框（LISTBOX）：自动排序/多列/允许多选→样式位，边框→exStyle，行间距/选中→LB_ 消息；文本/背景色→颜色表。
function buildStdListBoxCodegen(extraProps, isChecked) {
  const border = readIntProp(extraProps['边框'], isChecked ? 1 : 1);
  const sort = readBoolProp(extraProps['自动排序'], false);
  const multiCol = readBoolProp(extraProps['多列'], false);
  const multiSel = readBoolProp(extraProps['允许选择多项'], false);
  const rowExtra = readIntProp(extraProps['行间距'], 0);
  const curSel = readIntProp(extraProps['现行选中项'], -1);
  const textColor = readIntProp(extraProps['文本颜色'], 0);
  const backColor = readIntProp(extraProps['背景颜色'], 0xffffff);
  const parts = ['WS_CHILD', 'WS_TABSTOP', 'LBS_NOTIFY', 'LBS_HASSTRINGS'];
  if (multiCol)
    parts.push('LBS_MULTICOLUMN', 'WS_HSCROLL');
  else
    parts.push('WS_VSCROLL');
  if (sort)
    parts.push('LBS_SORT');
  if (!isChecked && multiSel)
    parts.push('LBS_EXTENDEDSEL', 'LBS_MULTIPLESEL');
  if (isChecked)
    parts.push('LBS_OWNERDRAWFIXED'); // 选择列表框：自绘复选框（WM_DRAWITEM 画勾选框+文本）
  if (border === 5)
    parts.push('WS_BORDER');
  const post = [];
  if (isChecked)
    post.push('SetWindowSubclass(hCtrl, YcChkListProc, 1, 0);'); // 选择列表框：挂子类做点击/空格切换勾选
  if (rowExtra > 0)
    post.push(`{ int ih = (int)SendMessage(hCtrl, LB_GETITEMHEIGHT, 0, 0); SendMessage(hCtrl, LB_SETITEMHEIGHT, 0, (LPARAM)(ih + ${rowExtra})); }`);
  if (curSel >= 0 && (isChecked || !multiSel))
    post.push(`SendMessage(hCtrl, LB_SETCURSEL, (WPARAM)${curSel}, 0);`);
  return { style: parts.join(' | '), exStyle: ctrlBorderExStyle(border), postCreateLines: post, colorEntry: (textColor !== 0 || backColor !== 0xffffff) ? { textColor, backColor } : null };
}
// 标准 BUTTON 控件同样忽略 WM_APP+1，按钮属性必须在创建时落成样式位。
// 类型/横向/纵向对齐/可停留焦点默认值须与 window-units.json 按钮定义一致。
// ownerDraw=true（设了底色或文本色）时用 BS_OWNERDRAW，颜色/文字由 WM_DRAWITEM 自绘。
function buildStdButtonCodegen(extraProps, hasImage, ownerDraw) {
  const style = readIntProp(extraProps['类型'], 0); // 0通常 1默认
  const hAlign = readIntProp(extraProps['横向对齐方式'], 1); // 0左 1中 2右
  const vAlign = readIntProp(extraProps['纵向对齐方式'], 1); // 0顶 1中 2底
  const tabStop = readBoolProp(extraProps['可停留焦点'], true);
  const parts = ['WS_CHILD'];
  if (ownerDraw) {
    parts.push('BS_OWNERDRAW');
  }
  else {
    parts.push(style === 1 ? 'BS_DEFPUSHBUTTON' : 'BS_PUSHBUTTON');
    parts.push(hAlign === 0 ? 'BS_LEFT' : hAlign === 2 ? 'BS_RIGHT' : 'BS_CENTER');
    parts.push(vAlign === 0 ? 'BS_TOP' : vAlign === 2 ? 'BS_BOTTOM' : 'BS_VCENTER');
    if (hasImage)
      parts.push('BS_BITMAP');
  }
  if (tabStop)
    parts.push('WS_TABSTOP');
  return { style: parts.join(' | ') };
}

// 编译器按名称调用：controlCodegen[名称](组件属性, ...附加参数)
exports.controlCodegen = {
  edit: buildStdEditCodegen,
  label: buildStdLabelCodegen,
  checkable: buildStdCheckableCodegen,
  groupBox: buildStdGroupBoxCodegen,
  picBox: buildStdPicBoxCodegen,
  progress: buildStdProgressCodegen,
  drawPanel: buildStdDrawPanelCodegen,
  slider: buildStdSliderCodegen,
  scrollBar: buildStdScrollBarCodegen,
  datePicker: buildStdDatePickerCodegen,
  monthCal: buildStdMonthCalCodegen,
  comboBox: buildStdComboBoxCodegen,
  listBox: buildStdListBoxCodegen,
  button: buildStdButtonCodegen,
}
