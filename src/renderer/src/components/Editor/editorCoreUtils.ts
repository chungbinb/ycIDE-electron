import { splitCSV } from './eycBlocks'
import { FLOW_KW } from './eycFlow'
import { parseColorLiteralToColorref, colorrefToHex } from '../../../../shared/colorNames'

export interface Span { text: string; cls: string; swatch?: string }

export interface CompletionParam {
  name: string
  type: string
  description: string
  optional: boolean
  repeatable?: boolean
  isVariable?: boolean
  isArray?: boolean
}

export interface CompletionItem {
  name: string
  englishName: string
  description: string
  returnType: string
  category: string
  libraryName: string
  isMember: boolean
  ownerTypeName: string
  params: CompletionParam[]
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export const MEMBER_DELIMITER_REGEX = /[。．]/g
export const MEMBER_DELIMITERS = new Set(['.', '。', '．'])

export const WINDOW_METHOD_WHITELIST = new Set([
  '取窗口句柄', '销毁', '获取焦点', '可有焦点',
  '取用户区宽度', '取用户区高度', '禁止重画', '允许重画',
  '重画', '部分重画', '取消重画', '刷新显示',
  '移动', '调整层次', '弹出菜单', '发送信息',
  '投递信息', '取标记组件', '置外形图片', '激活',
  '置托盘图标', '弹出托盘菜单', '置父窗口',
])

// 窗口/控件通用「对象」方法（易语言 对象.* 方法族，敲 窗口名. 时作方法成员补全）。
// 元数据取自 command-mapping.windows.json（含返回类型/参数），全部已实现。
export const WINDOW_OBJECT_METHODS: Array<{ name: string; returnType: string; description: string; params: CompletionParam[] }> = [
  { name: '销毁', returnType: '无返回值', description: '销毁该对象。', params: [{ name: '立即销毁', type: '逻辑型', description: '，可以被省略。通常情况下，调用销毁方法后为了考虑到事件处理子程序的后续安全操作，窗口真正的销毁工作会被延迟到所处事件处理子程序执行完毕后再进行，但有时由于某种特殊需要，可能希望窗口能够立即被销毁，设置本参数为真即可。注：1.核心库4.6版本以前(不包括4.6)由于不支持本参数，执行本方法始终会立即销毁；2.本参数仅在销毁窗口时有效，销毁窗口组件时始终都采取立即销毁方式。如果被省略，则参数默认值为假。', optional: true }] },
  { name: '重画', returnType: '无返回值', description: '立即重新绘制该对象。', params: [] },
  { name: '移动', returnType: '无返回值', description: '移动并调整该对象的位置和大小。', params: [{ name: '左边', type: '整数型', description: '，可以被省略。单位为像素点。如被省略则不改变左边原位置。', optional: true }, { name: '顶边', type: '整数型', description: '，可以被省略。单位为像素点。如被省略则不改变顶边原位置。', optional: true }, { name: '宽度', type: '整数型', description: '，可以被省略。单位为像素点。如被省略或等于 -1 ，则不改变原宽度。', optional: true }, { name: '高度', type: '整数型', description: '，可以被省略。单位为像素点。如被省略或等于 -1 ，则不改变原高度。', optional: true }] },
  { name: '激活', returnType: '无返回值', description: '激活该窗口（置于前台并获得焦点）。', params: [] },
  { name: '获取焦点', returnType: '无返回值', description: '使该对象获得输入焦点。', params: [] },
  { name: '可有焦点', returnType: '逻辑型', description: '返回该对象当前是否可以获得焦点。', params: [] },
  { name: '禁止重画', returnType: '无返回值', description: '禁止该对象重新绘制（批量更新时减少闪烁）。', params: [] },
  { name: '允许重画', returnType: '无返回值', description: '恢复该对象的重新绘制。', params: [] },
  { name: '部分重画', returnType: '无返回值', description: '重新绘制该对象的指定矩形区域。', params: [{ name: '欲重画区域的左边', type: '整数型', description: '。单位为像素点，相对于用户区域的左边。', optional: false }, { name: '欲重画区域的顶边', type: '整数型', description: '。单位为像素点，相对于用户区域的顶边。', optional: false }, { name: '欲重画区域的宽度', type: '整数型', description: '。单位为像素点。', optional: false }, { name: '欲重画区域的高度', type: '整数型', description: '。单位为像素点。', optional: false }] },
  { name: '取消重画', returnType: '无返回值', description: '取消之前设置的重画请求。', params: [] },
  { name: '刷新显示', returnType: '无返回值', description: '刷新该对象的显示。', params: [] },
  { name: '调整层次', returnType: '无返回值', description: '调整该对象在同级中的显示层次。', params: [{ name: '欲调整到的层次', type: '整数型', description: '，可以被省略。可以为以下常量之一： 1、#顶层； 2、#底层； 3、#最高层； 4、#次高层。如果被省略，默认为“#顶层”。', optional: true }] },
  { name: '弹出菜单', returnType: '无返回值', description: '在指定位置弹出快捷菜单。', params: [{ name: '欲弹出的菜单', type: '菜单', description: '。指定菜单内必须包含有子菜单，且所处窗口必须与调用对象窗口一致。', optional: false }, { name: '水平显示位置', type: '整数型', description: '，可以被省略。单位为像素点，相对于屏幕左边。如果被省略，将自动使用当前鼠标位置。', optional: true }, { name: '垂直显示位置', type: '整数型', description: '，可以被省略。单位为像素点，相对于屏幕顶边。如果被省略，将自动使用当前鼠标位置。', optional: true }] },
  { name: '发送信息', returnType: '整数型', description: '向该对象发送 Windows 消息并等待处理返回。', params: [{ name: '信息值', type: '整数型', description: '。', optional: false }, { name: '参数1', type: '整数型', description: '，初始值为“0”。', optional: false }, { name: '参数2', type: '整数型', description: '，初始值为“0”。', optional: false }] },
  { name: '投递信息', returnType: '无返回值', description: '向该对象投递 Windows 消息后立即返回。', params: [{ name: '信息值', type: '整数型', description: '。', optional: false }, { name: '参数1', type: '整数型', description: '，初始值为“0”。', optional: false }, { name: '参数2', type: '整数型', description: '，初始值为“0”。', optional: false }] },
  { name: '置父窗口', returnType: '无返回值', description: '设置该窗口的父窗口。', params: [{ name: '父窗口或窗口组件', type: '通用型', description: '。参数值提供欲设置为本对象窗口组件父窗口的窗口或窗口组件。', optional: false }] },
  { name: '取窗口句柄', returnType: '整数型', description: '取该对象的窗口句柄。', params: [] },
  { name: '取标记组件', returnType: '通用型', description: '取指定标记值的子组件。', params: [{ name: '欲寻找组件的标记数值', type: '整数型', description: '。即该组件的“标记”属性文本的数值形式。', optional: false }] },
  { name: '置外形图片', returnType: '逻辑型', description: '用图片设置窗口的异形外形（透明色部分镂空）。', params: [{ name: '图片数据', type: '通用型', description: '。参数值可以为 .JPG、.GIF、.BMP、.DIB 等等被支持格式的图片数据、图片资源或图片文件名。', optional: false }, { name: '透明颜色', type: '整数型', description: '，可以被省略。指定图片中透明部分的颜色。如果被省略，默认为白色。', optional: true }] },
  { name: '置托盘图标', returnType: '无返回值', description: '在系统托盘区放置图标。', params: [{ name: '图标数据', type: '通用型', description: '，可以被省略。参数值可以为图标字节集数据、图标资源或图标文件名。如果省略本参数，默认为清除已有的本程序图标。', optional: true }, { name: '提示信息', type: '文本型', description: '，可以被省略。本参数指定当鼠标移动到图标上后显示的提示信息。如果省略本参数，默认为空文本。', optional: true }] },
  { name: '取用户区宽度', returnType: '整数型', description: '取窗口客户区的宽度（像素）。', params: [] },
  { name: '取用户区高度', returnType: '整数型', description: '取窗口客户区的高度（像素）。', params: [] },
  { name: '弹出托盘菜单', returnType: '无返回值', description: '弹出系统托盘图标的菜单。', params: [{ name: '欲弹出的菜单', type: '菜单', description: '。指定菜单内必须包含有子菜单，且所处窗口必须与调用对象窗口一致。', optional: false }] },
]

// 各控件类型专属方法（对象通用方法之外的），敲「控件名.」时按类型追加为方法成员。
export const CONTROL_TYPE_METHODS: Record<string, Array<{ name: string; returnType: string; description: string; params: CompletionParam[] }>> = {
  '编辑框': [
    // 尾参可重复（帮助文件：「命令参数表中最后一个参数可以被重复添加」）→ 展开参数行回车可追加下一个值行
    { name: '加入文本', returnType: '无返回值', description: '将指定文本加入到编辑框内容的尾部。可一次加入多个文本（在展开的参数行上回车追加）。', params: [{ name: '欲加入文本', type: '文本型', description: '', optional: false, repeatable: true }] },
  ],
  '标签': [
    { name: '调用反馈事件', returnType: '整数型', description: '产生标签的“反馈事件”，调用其用户事件处理子程序（可用于多线程将控制权转移到主线程）。返回事件子程序的返回值。', params: [{ name: '参数一', type: '整数型', description: '，可省略，默认 0。', optional: true }, { name: '参数二', type: '整数型', description: '，可省略，默认 0。', optional: true }, { name: '事件传递方式', type: '逻辑型', description: '，可省略。真=发送（等待处理完），假=投递（不等待）。默认真。', optional: true }] },
  ],
  '超级链接框': [
    { name: '跳转', returnType: '无返回值', description: '跳转到指定的电子信箱或 Internet 地址（依“类型”属性决定打开哪个）。初级对象成员命令。', params: [] },
  ],
  '通用对话框': [
    { name: '打开', returnType: '逻辑型', description: '打开当前「类型」属性对应的对话框（打开文件/保存文件/字体选择/打开帮助）。打开文件、保存文件、字体选择：返回真表示用户已输入有效数据，返回假表示用户取消；打开帮助：打开成功返回真（英文名 open）。初级对象成员命令。', params: [] },
  ],
  '组合框': [
    { name: '加入项目', returnType: '整数型', description: '加入指定项目到组合框列表部分的尾部，成功返回加入后该项目所处的位置，失败返回 -1（英文名 AddString）。', params: [{ name: '欲加入项目的文本', type: '文本型', description: '要加入到列表尾部的项目文本。', optional: false }, { name: '与欲加入项目相关的数值', type: '整数型', description: '与该项目相关联的数值，可省略，省略时默认为 0。', optional: true }] },
    { name: '插入项目', returnType: '整数型', description: '插入指定项目到组合框列表部分的指定位置处，成功返回插入后该项目所处的位置，失败返回 -1（英文名 InsertString）。', params: [{ name: '欲插入的位置', type: '整数型', description: '插入位置，0 为项目位置一，1 为项目位置二，如此类推。', optional: false }, { name: '欲插入项目的文本', type: '文本型', description: '要插入的项目文本。', optional: false }, { name: '与欲插入项目相关的数值', type: '整数型', description: '与该项目相关联的数值，可省略，省略时默认为 0。', optional: true }] },
    { name: '删除项目', returnType: '逻辑型', description: '删除组合框列表部分指定位置处的项目，成功返回真，失败返回假（英文名 DeleteString）。', params: [{ name: '项目索引', type: '整数型', description: '要删除项目的索引，0 为项目一，1 为项目二，如此类推。', optional: false }] },
    { name: '清空', returnType: '无返回值', description: '删除组合框列表部分中的所有项目（英文名 clear）。', params: [] },
    { name: '取项目数', returnType: '整数型', description: '返回组合框列表部分中的项目总数（英文名 GetCount）。', params: [] },
    { name: '取项目文本', returnType: '文本型', description: '返回指定项目的文本，如果指定项目不存在则返回空文本（英文名 GetItemText）。', params: [{ name: '项目索引', type: '整数型', description: '项目索引，0 为项目一，1 为项目二，如此类推。', optional: false }] },
    { name: '置项目文本', returnType: '逻辑型', description: '设置指定项目的文本，成功返回真，失败返回假（英文名 SetItemtext）。', params: [{ name: '项目索引', type: '整数型', description: '项目索引，0 为项目一，1 为项目二，如此类推。', optional: false }, { name: '欲置入的项目文本', type: '文本型', description: '要置入指定项目的新文本。', optional: false }] },
    { name: '取项目数值', returnType: '整数型', description: '返回与指定项目相关联的数值，如果指定项目不存在则返回 -1（英文名 GetItemData）。', params: [{ name: '项目索引', type: '整数型', description: '项目索引，0 为项目一，1 为项目二，如此类推。', optional: false }] },
    { name: '置项目数值', returnType: '逻辑型', description: '设置与指定项目相关联的数值，成功返回真，失败返回假（英文名 SetItemData）。', params: [{ name: '项目索引', type: '整数型', description: '项目索引，0 为项目一，1 为项目二，如此类推。', optional: false }, { name: '欲置入的项目数值', type: '整数型', description: '与指定项目相关联的数值。', optional: false }] },
    { name: '取顶端可见项目', returnType: '整数型', description: '返回组合框列表部分中当前最顶端可见项目的索引，0 为项目一，如此类推，失败返回 -1（英文名 GetTopIndex）。', params: [] },
    { name: '置顶端可见项目', returnType: '逻辑型', description: '设置组合框列表部分中当前最顶端的可见项目，必要时自动滚动列表，成功返回真，失败返回假（英文名 SetTopIndex）。', params: [{ name: '项目索引', type: '整数型', description: '要置为顶端可见的项目索引，0 为项目一，1 为项目二，如此类推。', optional: false }] },
    { name: '选择', returnType: '整数型', description: '在所有项目中寻找首部包含指定文本的项目，找到则选中它并返回该项目位置索引，否则返回 -1（英文名 SelItem）。', params: [{ name: '欲选择的项目文本', type: '文本型', description: '用于匹配项目首部的文本。', optional: false }] },
  ],
  '选择夹': [
    { name: '取子夹数目', returnType: '整数型', description: '取选择夹内子夹（选项卡页）的总数目。', params: [] },
    { name: '取子夹名称', returnType: '文本型', description: '取指定索引子夹的名称（表头标签文字）。', params: [{ name: '子夹索引', type: '整数型', description: '子夹的序号，1 代表子夹一、2 代表子夹二，依此类推。', optional: false }] },
    { name: '置子夹名称', returnType: '逻辑型', description: '设置指定索引子夹的名称，置入成功返回真、否则返回假。', params: [{ name: '子夹索引', type: '整数型', description: '子夹的序号，1 代表子夹一、2 代表子夹二，依此类推。', optional: false }, { name: '欲置入的子夹名称', type: '文本型', description: '要置入该子夹的名称文字。', optional: false }] },
  ],
  '列表框': [
    { name: '删除项目', returnType: '逻辑型', description: '删除列表框指定位置处的项目，成功返回真、失败返回假。', params: [{ name: '项目索引', type: '整数型', description: '0为项目一，1为项目二，如此类推。', optional: false }] },
    { name: '加入项目', returnType: '整数型', description: '加入指定项目到列表框尾部，成功返回加入后该项目所处的位置、失败返回-1。', params: [{ name: '欲加入项目的文本', type: '文本型', description: '要加入的项目文本。', optional: false }, { name: '与欲加入项目相关的数值', type: '整数型', description: '与该项目关联的数值，省略时默认为0。', optional: true }] },
    { name: '取已选择项目数', returnType: '整数型', description: '返回已被选择项目的数目。', params: [] },
    { name: '取所有被选择项目', returnType: '整数型数组', description: '返回内含所有当前被选择项目位置索引的整数数组，无被选择项目时返回空数组。', params: [] },
    { name: '取焦点项目', returnType: '整数型', description: '返回当前焦点项目的位置索引（用于多选列表框；单选列表框中返回当前被选择项目的位置索引）。', params: [] },
    { name: '取顶端可见项目', returnType: '整数型', description: '返回列表框中当前最顶端可见项目的索引，失败返回-1。', params: [] },
    { name: '取项目数', returnType: '整数型', description: '返回列表框中项目的总数。', params: [] },
    { name: '取项目数值', returnType: '整数型', description: '返回与指定项目相关联的数值，指定项目不存在时返回-1。', params: [{ name: '项目索引', type: '整数型', description: '0为项目一，1为项目二，如此类推。', optional: false }] },
    { name: '取项目文本', returnType: '文本型', description: '返回指定项目的文本，指定项目不存在时返回空文本。', params: [{ name: '项目索引', type: '整数型', description: '0为项目一，1为项目二，如此类推。', optional: false }] },
    { name: '插入项目', returnType: '整数型', description: '插入指定项目到列表框的指定位置处，成功返回插入后该项目所处的位置、失败返回-1。', params: [{ name: '欲插入的位置', type: '整数型', description: '0为项目位置一，1为项目位置二，如此类推。', optional: false }, { name: '欲插入项目的文本', type: '文本型', description: '要插入的项目文本。', optional: false }, { name: '与欲插入项目相关的数值', type: '整数型', description: '与该项目关联的数值，省略时默认为0。', optional: true }] },
    { name: '是否被选择', returnType: '逻辑型', description: '指定项目被选择则返回真，否则返回假。', params: [{ name: '项目索引', type: '整数型', description: '0为项目一，1为项目二，如此类推。', optional: false }] },
    { name: '清空', returnType: '无返回值', description: '删除列表框中的所有项目。', params: [] },
    { name: '置焦点项目', returnType: '逻辑型', description: '设置当前焦点项目（用于多选列表框；单选列表框中设置当前被选择项目），成功返回真、失败返回假。', params: [{ name: '项目索引', type: '整数型', description: '0为项目一，1为项目二，如此类推。', optional: false }] },
    { name: '置顶端可见项目', returnType: '逻辑型', description: '设置列表框中当前最顶端的可见项目，必要时自动滚动列表框，成功返回真、失败返回假。', params: [{ name: '项目索引', type: '整数型', description: '0为项目一，1为项目二，如此类推。', optional: false }] },
    { name: '置项目数值', returnType: '逻辑型', description: '设置与指定项目相关联的数值，成功返回真、失败返回假。', params: [{ name: '项目索引', type: '整数型', description: '0为项目一，1为项目二，如此类推。', optional: false }, { name: '欲置入的项目数值', type: '整数型', description: '与指定项目相关联的数值。', optional: false }] },
    { name: '置项目文本', returnType: '逻辑型', description: '设置指定项目的文本，成功返回真、失败返回假。', params: [{ name: '项目索引', type: '整数型', description: '0为项目一，1为项目二，如此类推。', optional: false }, { name: '欲置入的项目文本', type: '文本型', description: '要设置的项目文本。', optional: false }] },
    { name: '选择', returnType: '整数型', description: '在所有项目中查找首部包含指定文本的项目，找到则选中并返回其位置索引、否则返回-1（仅单选列表框有效，多选列表框返回-1）。', params: [{ name: '欲选择的项目文本', type: '文本型', description: '用于匹配项目首部的文本。', optional: false }] },
    { name: '选择项目', returnType: '逻辑型', description: '选择或取消选择指定项目，成功返回真、失败返回假。', params: [{ name: '欲选择或取消选择的项目索引', type: '整数型', description: '0为项目一，1为项目二，如此类推。', optional: false }, { name: '欲置入的项目选择状态', type: '逻辑型', description: '省略或为真则选择该项目，否则取消对该项目的选择。', optional: true }] },
  ],
  '选择列表框': [
    { name: '取顶端可见项目', returnType: '整数型', description: '英文名 GetTopIndex。返回列表框中当前最顶端可见项目的索引，0 为项目一，失败返回 -1。运行期映射 LB_GETTOPINDEX。', params: [] },
    { name: '置顶端可见项目', returnType: '逻辑型', description: '英文名 SetTopIndex。设置列表框中当前最顶端的可见项目，必要时自动滚动列表框，成功返回真、失败返回假。运行期映射 LB_SETTOPINDEX。', params: [{ name: '项目索引', type: '整数型', description: '0 为项目一，1 为项目二，如此类推。', optional: false }] },
    { name: '取项目数', returnType: '整数型', description: '英文名 GetCount。返回列表框中的项目总数。运行期映射 LB_GETCOUNT。', params: [] },
    { name: '取项目数值', returnType: '整数型', description: '英文名 GetItemData。返回与指定项目相关联的数值，项目不存在返回 -1。运行期映射 LB_GETITEMDATA。', params: [{ name: '项目索引', type: '整数型', description: '0 为项目一，1 为项目二，如此类推。', optional: false }] },
    { name: '置项目数值', returnType: '逻辑型', description: '英文名 SetItemData。设置与指定项目相关联的数值，成功返回真、失败返回假。运行期映射 LB_SETITEMDATA。', params: [{ name: '项目索引', type: '整数型', description: '0 为项目一，1 为项目二，如此类推。', optional: false }, { name: '欲置入的项目数值', type: '整数型', description: '该数值与指定项目相关联。', optional: false }] },
    { name: '取项目文本', returnType: '文本型', description: '英文名 GetItemText。返回指定项目的文本，项目不存在返回空文本。运行期映射 LB_GETTEXT。', params: [{ name: '项目索引', type: '整数型', description: '0 为项目一，1 为项目二，如此类推。', optional: false }] },
    { name: '置项目文本', returnType: '逻辑型', description: '英文名 SetItemtext。设置指定项目的文本，成功返回真、失败返回假。无直接 Win32 消息，运行期以 LB_DELETESTRING+LB_INSERTSTRING 组合实现并保持数值/勾选状态。', params: [{ name: '项目索引', type: '整数型', description: '0 为项目一，1 为项目二，如此类推。', optional: false }, { name: '欲置入的项目文本', type: '文本型', description: '要写入该项目的新文本。', optional: false }] },
    { name: '加入项目', returnType: '整数型', description: '英文名 AddString。加入指定项目到列表框尾部，成功返回加入后该项目所处的位置、失败返回 -1。运行期映射 LB_ADDSTRING(+LB_SETITEMDATA 落数值)。', params: [{ name: '欲加入项目的文本', type: '文本型', description: '要加入的项目文本。', optional: false }, { name: '与欲加入项目相关的数值', type: '整数型', description: '与该项目关联的数值，省略时默认为 0。', optional: true }] },
    { name: '插入项目', returnType: '整数型', description: '英文名 InsertString。插入指定项目到列表框的指定位置处，成功返回插入后该项目所处的位置、失败返回 -1。运行期映射 LB_INSERTSTRING(+LB_SETITEMDATA 落数值)。', params: [{ name: '欲插入的位置', type: '整数型', description: '0 为项目位置一，1 为项目位置二，如此类推。', optional: false }, { name: '欲插入项目的文本', type: '文本型', description: '要插入的项目文本。', optional: false }, { name: '与欲插入项目相关的数值', type: '整数型', description: '与该项目关联的数值，省略时默认为 0。', optional: true }] },
    { name: '删除项目', returnType: '逻辑型', description: '英文名 DeleteString。删除列表框指定位置处的项目，成功返回真、失败返回假。运行期映射 LB_DELETESTRING(并同步移除并行的勾选/允许状态)。', params: [{ name: '项目索引', type: '整数型', description: '0 为项目一，1 为项目二，如此类推。', optional: false }] },
    { name: '清空', returnType: '无返回值', description: '英文名 clear。删除列表框中的所有项目。运行期映射 LB_RESETCONTENT(并清空并行的勾选/允许状态表)。', params: [] },
    { name: '选择', returnType: '整数型', description: '英文名 SelItem。在所有项目中寻找首部包含指定文本的项目，找到则选中并返回其位置索引，否则返回 -1。运行期映射 LB_FINDSTRING+LB_SETCURSEL(或 LB_SELECTSTRING)。', params: [{ name: '欲选择的项目文本', type: '文本型', description: '用于匹配项目首部的文本。', optional: false }] },
    { name: '是否被选中', returnType: '逻辑型', description: '英文名 IsChecked。如果与指定项目对应的选择框被选中则返回真，否则返回假。需勾选状态并行表(勾选 owner-draw 基础设施)。', params: [{ name: '项目索引', type: '整数型', description: '0 为项目一，1 为项目二，如此类推。', optional: false }] },
    { name: '选中项目', returnType: '逻辑型', description: '英文名 SetCheck。选中或取消选中与指定项目对应的选择框，成功返回真、失败返回假。需勾选状态并行表并触发重绘(InvalidateRect)。', params: [{ name: '欲选择或取消选择的项目索引', type: '整数型', description: '0 为项目一，1 为项目二，如此类推。', optional: false }, { name: '欲置入的项目选择状态', type: '逻辑型', description: '省略或为真则选中该项目，否则取消选中。', optional: true }] },
    { name: '是否被允许', returnType: '逻辑型', description: '英文名 IsEnabled。如果与指定项目对应的选择框被允许操作则返回真，否则返回假。需允许状态并行表。', params: [{ name: '项目索引', type: '整数型', description: '0 为项目一，1 为项目二，如此类推。', optional: false }] },
    { name: '允许', returnType: '逻辑型', description: '英文名 enable。允许或禁止对指定项目进行选择操作，成功返回真、失败返回假。需允许状态并行表并触发重绘。', params: [{ name: '欲允许或禁止操作的项目索引', type: '整数型', description: '0 为项目一，1 为项目二，如此类推。', optional: false }, { name: '允许或禁止', type: '逻辑型', description: '省略或为真则允许该项目，否则禁止对该项目进行选中操作。', optional: true }] },
  ],
  '画板': [
    { name: '取设备句柄', returnType: '整数型', description: '英文名 GetHDC。如当前正在处理本画板的“绘画”事件，则返回画板所对应的设备句柄(HDC)，否则返回 0。高级对象成员命令。', params: [] },
    { name: '清除', returnType: '无返回值', description: '英文名 cls。清除画板上指定区域的内容并将当前文本写出位置移动到被清除区左上角。省略参数时默认清除到画板右/下边缘。', params: [{ name: '清除区左上角横坐标', type: '整数型', description: '现行绘画单位，相对于画板左上角，省略默认 0。', optional: true }, { name: '清除区左上角纵坐标', type: '整数型', description: '省略默认 0。', optional: true }, { name: '清除区宽度', type: '整数型', description: '省略默认到画板右边。', optional: true }, { name: '清除区高度', type: '整数型', description: '省略默认到画板底边。', optional: true }] },
    { name: '取点', returnType: '整数型', description: '英文名 GetPixel。返回画板上指定点的颜色值，失败返回 -1。', params: [{ name: '点横坐标', type: '整数型', description: '现行绘画单位，相对于画板左上角。', optional: false }, { name: '点纵坐标', type: '整数型', description: '现行绘画单位，相对于画板左上角。', optional: false }] },
    { name: '画点', returnType: '无返回值', description: '英文名 SetPixel。在画板指定点画入指定颜色。', params: [{ name: '点横坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '点纵坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '欲画入点的颜色值', type: '整数型', description: '颜色值。', optional: false }] },
    { name: '画直线', returnType: '无返回值', description: '英文名 LineTo。使用画笔在画板上画出一条直线。', params: [{ name: '起始点横坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '起始点纵坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '结束点横坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '结束点纵坐标', type: '整数型', description: '现行绘画单位。', optional: false }] },
    { name: '画椭圆', returnType: '无返回值', description: '英文名 ellipse。使用画笔画椭圆，内部用当前刷子填充。', params: [{ name: '椭圆左上角横坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '椭圆左上角纵坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '椭圆右下角横坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '椭圆右下角纵坐标', type: '整数型', description: '现行绘画单位。', optional: false }] },
    { name: '画弧线', returnType: '无返回值', description: '英文名 ArcTo。使用画笔在画板上画出一条弧线（起止点为椭圆中心到该点的连线与弧的交点）。', params: [{ name: '椭圆左上角横坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '椭圆左上角纵坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '椭圆右下角横坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '椭圆右下角纵坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '弧线起始点横坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '弧线起始点纵坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '弧线终止点横坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '弧线终止点纵坐标', type: '整数型', description: '现行绘画单位。', optional: false }] },
    { name: '画弦', returnType: '无返回值', description: '英文名 chord。画弦（弧线两端点连线围成的封闭区域，内部用当前刷子填充）。参数同“画弧线”。', params: [{ name: '椭圆左上角横坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '椭圆左上角纵坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '椭圆右下角横坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '椭圆右下角纵坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '弧线起始点横坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '弧线起始点纵坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '弧线终止点横坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '弧线终止点纵坐标', type: '整数型', description: '现行绘画单位。', optional: false }] },
    { name: '画饼', returnType: '无返回值', description: '英文名 pie。画饼形（扇形，内部用当前刷子填充）。参数同“画弧线”。', params: [{ name: '椭圆左上角横坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '椭圆左上角纵坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '椭圆右下角横坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '椭圆右下角纵坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '弧线起始点横坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '弧线起始点纵坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '弧线终止点横坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '弧线终止点纵坐标', type: '整数型', description: '现行绘画单位。', optional: false }] },
    { name: '画矩形', returnType: '无返回值', description: '英文名 DrawRect。使用画笔画矩形，内部用当前刷子填充。', params: [{ name: '矩形左上角横坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '矩形左上角纵坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '矩形右下角横坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '矩形右下角纵坐标', type: '整数型', description: '现行绘画单位。', optional: false }] },
    { name: '画渐变矩形', returnType: '无返回值', description: '英文名 DrawJBRect。画渐变填充的矩形。最后的渐变颜色参数可重复添加。', params: [{ name: '矩形区域左边', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '矩形区域顶边', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '矩形区域宽度', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '矩形区域高度', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '渐变方向', type: '整数型', description: '1 上到下/2 左到右/3 左上到右下/4 右上到左下/5 下到上/6 右到左/7 右下到左上/8 左下到右上，省略默认左到右。', optional: true }, { name: '首渐变颜色', type: '整数型', description: '。', optional: false }, { name: '其它渐变颜色', type: '整数型', description: '可重复。', optional: false }] },
    { name: '填充矩形', returnType: '无返回值', description: '英文名 FillRect。用当前刷子填充指定矩形区域。', params: [{ name: '矩形左上角横坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '矩形左上角纵坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '矩形右下角横坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '矩形右下角纵坐标', type: '整数型', description: '现行绘画单位。', optional: false }] },
    { name: '画圆角矩形', returnType: '无返回值', description: '英文名 RoundRect。画圆角矩形，内部用当前刷子填充。', params: [{ name: '矩形左上角横坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '矩形左上角纵坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '矩形右下角横坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '矩形右下角纵坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '圆角宽度', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '圆角高度', type: '整数型', description: '省略时默认与圆角宽度相等。', optional: true }] },
    { name: '翻转矩形区', returnType: '无返回值', description: '英文名 InvertRect。将画板上指定矩形区域的颜色翻转过来。', params: [{ name: '矩形左上角横坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '矩形左上角纵坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '矩形右下角横坐标', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '矩形右下角纵坐标', type: '整数型', description: '现行绘画单位。', optional: false }] },
    { name: '画多边形', returnType: '无返回值', description: '英文名 polygon。画多边形（未闭合自动闭合），内部用当前刷子填充。顶点数组顺序记录各顶点横、纵坐标。', params: [{ name: '多边形顶点', type: '整数型数组', description: '顺序记录各顶点横向及纵向坐标值（现行绘画单位）。', optional: false }, { name: '顶点数目', type: '整数型', description: '省略时默认为数组中记录的顶点数目。', optional: true }] },
    { name: '置写出位置', returnType: '无返回值', description: '英文名 SetWritePos。设置下次“写文本行/写出”输出数据时的位置。省略参数则用现行位置。', params: [{ name: '横向写出位置', type: '整数型', description: '现行绘画单位，省略用现行横向位置。', optional: true }, { name: '纵向写出位置', type: '整数型', description: '现行绘画单位，省略用现行纵向位置。', optional: true }] },
    { name: '写文本行', returnType: '无返回值', description: '英文名 print。在当前写出位置写出文本/数值/逻辑值/日期时间并换到下行行首。最后参数可重复，省略则写空行。', params: [{ name: '欲写出数据', type: '通用型', description: '只能为文本、数值、逻辑值或日期时间；省略写空行。', optional: true }] },
    { name: '滚动写行', returnType: '无返回值', description: '英文名 sprint。同“写文本行”，但画板高度不足容纳当前行时自动向上滚动画板内容。', params: [{ name: '欲写出数据', type: '通用型', description: '只能为文本、数值、逻辑值或日期时间；省略写空行。', optional: true }] },
    { name: '写出', returnType: '无返回值', description: '英文名 write。在当前写出位置写出数据，写出位置移动到所写数据末尾。', params: [{ name: '欲写出数据', type: '通用型', description: '只能为文本、数值、逻辑值或日期时间；省略写空行。', optional: true }] },
    { name: '定位写出', returnType: '无返回值', description: '英文名 say。在指定位置写出数据，不改变现行写出位置。', params: [{ name: '横向写出位置', type: '整数型', description: '现行绘画单位，省略用现行横向位置。', optional: true }, { name: '纵向写出位置', type: '整数型', description: '现行绘画单位，省略用现行纵向位置。', optional: true }, { name: '欲写出数据', type: '通用型', description: '只能为文本、数值、逻辑值或日期时间。', optional: false }] },
    { name: '取宽度', returnType: '整数型', description: '英文名 GetWidth。返回指定数据的写出宽度（现行绘画单位）。', params: [{ name: '欲取其宽度或高度的数据', type: '通用型', description: '只能为文本、数值、逻辑值或日期时间。', optional: false }] },
    { name: '取高度', returnType: '整数型', description: '英文名 GetHeight。返回指定数据的写出高度（现行绘画单位）。', params: [{ name: '欲取其宽度或高度的数据', type: '通用型', description: '只能为文本、数值、逻辑值或日期时间。', optional: false }] },
    { name: '画图片', returnType: '无返回值', description: '英文名 DrawPic。在画板上画出图片。本 IDE 当前支持传入图片字节集数据；图片号（“载入图片”返回值）形态暂未支持。', params: [{ name: '图片', type: '通用型', description: '图片字节集数据（或图片号，暂未支持）。', optional: false }, { name: '图片左边画出位置', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '图片顶边画出位置', type: '整数型', description: '现行绘画单位。', optional: false }, { name: '图片画出宽度', type: '整数型', description: '省略用图片本身宽度。', optional: true }, { name: '图片画出高度', type: '整数型', description: '省略用图片本身高度。', optional: true }, { name: '图片画出方法', type: '整数型', description: '1 拷贝/2 翻转拷贝/3 位异或/4 位或/5 位与，省略默认拷贝。', optional: true }] },
    { name: '取图片宽度', returnType: '整数型', description: '英文名 GetPicWidth。返回指定图片的宽度（现行绘画单位）。传入图片字节集数据。', params: [{ name: '图片', type: '通用型', description: '图片字节集数据（或图片号，暂未支持）。', optional: false }] },
    { name: '取图片高度', returnType: '整数型', description: '英文名 GetPicHeight。返回指定图片的高度（现行绘画单位）。传入图片字节集数据。', params: [{ name: '图片', type: '通用型', description: '图片字节集数据（或图片号，暂未支持）。', optional: false }] },
    { name: '复制', returnType: '无返回值', description: '英文名 copy。将源画板指定区域内容快速复制到目的画板指定位置（源不可视时其“自动重画”须为真）。', params: [{ name: '欲复制区域的左边', type: '整数型', description: '源画板现行绘画单位，省略默认 0。', optional: true }, { name: '欲复制区域的顶边', type: '整数型', description: '省略默认 0。', optional: true }, { name: '欲复制区域的宽度', type: '整数型', description: '省略默认源画板宽度。', optional: true }, { name: '欲复制区域的高度', type: '整数型', description: '省略默认源画板高度。', optional: true }, { name: '复制到的目的画板', type: '画板', description: '省略默认复制到源画板自身。', optional: true }, { name: '欲复制到位置左边', type: '整数型', description: '目的画板现行绘画单位，省略默认 0。', optional: true }, { name: '欲复制到位置顶边', type: '整数型', description: '省略默认 0。', optional: true }, { name: '复制方法', type: '整数型', description: '1 拷贝/2 翻转拷贝/3 位异或/4 位或/5 位与，省略默认拷贝。', optional: true }] },
    { name: '取图片', returnType: '字节集', description: '英文名 GetPic。返回画板上所有现有显示内容的图片数据（PNG 字节集），失败返回空字节集。', params: [{ name: '输出宽度', type: '整数型', description: '<0 为相对百分比(最小10%)、0 原宽度、>0 绝对宽度，省略默认 0。', optional: true }, { name: '输出高度', type: '整数型', description: '<0 为相对百分比(最小10%)、0 原高度、>0 绝对高度，省略默认 0。', optional: true }] },
    { name: '单位转换', returnType: '整数型', description: '英文名 UnitCnv。在像素单位与当前绘画单位之间转换坐标值。', params: [{ name: '欲转换的座标值', type: '整数型', description: '欲转换的横向或纵向坐标值。', optional: false }, { name: '欲转换座标值的类型', type: '整数型', description: '1 横向绘画单位/2 纵向绘画单位/3 横向像素单位/4 纵向像素单位（据此作相反方向的换算）。', optional: false }] },
  ],
}

// 控件方法命令详情（结构与 OutputPanel.CommandDetail 一致，供点击提示面板用）。
export interface ControlMethodDetail {
  name: string
  englishName: string
  description: string
  returnType: string
  category: string
  libraryName: string
  params: Array<{ name: string; type: string; description: string; optional: boolean; repeatable?: boolean; isVariable: boolean; isArray: boolean }>
}

// 跨控件类型按方法名找一条控件方法定义。入参可带对象前缀（`编辑框1.加入文本` → `加入文本`）。
// 现有数据里方法名要么唯一（加入文本）、要么同名同签名（list 族 加入项目/取项目文本 各类型雷同），故按名查即可。
function findControlMethodEntry(rawName: string): { ctrlType: string; method: { name: string; returnType: string; description: string; params: CompletionParam[] } } | null {
  const name = (rawName || '').trim().replace(/^.*[.。．]/, '')
  if (!name) return null
  for (const [ctrlType, methods] of Object.entries(CONTROL_TYPE_METHODS)) {
    const method = methods.find(x => x.name === name)
    if (method) return { ctrlType, method }
  }
  return null
}

// 控件方法（编辑框.加入文本 等）在库命令目录里没有——其签名真源就是上面的 CONTROL_TYPE_METHODS。
// 点击提示时按方法名查一份构造详情，否则会落到"未在已加载的支持库中找到此命令"（空参数）。
export function resolveControlMethodDetail(rawName: string): ControlMethodDetail | null {
  const hit = findControlMethodEntry(rawName)
  if (!hit) return null
  const { ctrlType, method: m } = hit
  return {
    name: m.name,
    englishName: '',
    description: m.description,
    returnType: m.returnType,
    category: '控件方法',
    libraryName: `系统核心支持库->${ctrlType}`,
    params: m.params.map(p => ({
      name: p.name, type: p.type, description: p.description || '',
      optional: !!p.optional, repeatable: p.repeatable, isVariable: !!p.isVariable, isArray: !!p.isArray,
    })),
  }
}

// 控件方法的「补全项」形态：供表格编辑器判定「这行有参数、可展开」并渲染参数行
// （库命令/DLL/项目类方法之外的第四路来源，缺它则 编辑框1.加入文本(a) 行左边不出 +/- 展开按钮）。
export function findControlMethodCompletion(rawName: string): CompletionItem | null {
  const hit = findControlMethodEntry(rawName)
  if (!hit) return null
  const { ctrlType, method: m } = hit
  return {
    name: m.name,
    englishName: '',
    description: m.description,
    returnType: m.returnType,
    category: '控件方法',
    libraryName: '系统核心支持库',
    isMember: true,
    ownerTypeName: ctrlType,
    params: m.params,
  }
}

const NUMERIC_TYPE_COMMON_NOTE = '字节型、短整数型、整数型、长整数型、小数型、双精度小数型统称为数值型，彼此可转换；编程时需注意溢出与精度丢失（例如 257 转字节型后为 1）。'

export const BUILTIN_TYPE_ITEMS: Array<{ name: string; englishName: string; description: string }> = [
  { name: '字节型', englishName: 'byte', description: '可容纳 0 到 255 之间的数值。' + NUMERIC_TYPE_COMMON_NOTE },
  { name: '短整数型', englishName: 'short', description: '可容纳 -32,768 到 32,767 之间的数值，尺寸为 2 个字节。' + NUMERIC_TYPE_COMMON_NOTE },
  { name: '整数型', englishName: 'int', description: '可容纳 -2,147,483,648 到 2,147,483,647 之间的数值，尺寸为 4 个字节。' + NUMERIC_TYPE_COMMON_NOTE },
  { name: '长整数型', englishName: 'int64', description: '可容纳 -9,223,372,036,854,775,808 到 9,223,372,036,854,775,807 之间的数值，尺寸为 8 个字节。' + NUMERIC_TYPE_COMMON_NOTE },
  { name: '小数型', englishName: 'float', description: '可容纳 3.4E +/- 38（7位小数）之间的数值，尺寸为 4 个字节。' + NUMERIC_TYPE_COMMON_NOTE },
  { name: '双精度小数型', englishName: 'double', description: '可容纳 1.7E +/- 308（15位小数）之间的数值，尺寸为 8 个字节。' + NUMERIC_TYPE_COMMON_NOTE },
  { name: '大整数型', englishName: 'bigint', description: '任意精度整数。用于超出“长整数型”范围的整型计算。' },
  { name: '逻辑型', englishName: 'bool', description: '值只可能为“真”或“假”，尺寸为 2 个字节。“真”和“假”为系统预定义常量，其对应的英文常量名称为“true”和“false”。' },
  { name: '日期时间型', englishName: 'datetime', description: '用作记录日期及时间，尺寸为 8 个字节。' },
  { name: '文本型', englishName: 'text', description: '用作记录一段文本，文本由以字节 0 结束的一系列字符组成。' },
  { name: '字节集', englishName: 'bin', description: '用作记录一段字节型数据。字节集与字节数组之间可以互相转换，在程序中允许使用字节数组的地方也可以使用字节集，或者相反。字节数组的使用方法，譬如用中括号对“[]”加索引数值引用字节成员，使用数组型数值数据进行赋值等等，都可以被字节集所使用。两者之间唯一的不同是字节集可以变长，因此可把字节集看作可变长的字节数组。' },
  { name: '子程序指针', englishName: 'subptr', description: '用作指向一个子程序，尺寸为 4 个字节。具有此数据类型的容器可以用来间接调用子程序。参见例程 sample.e 中的相应部分。' },
  { name: '通用型', englishName: 'any', description: '可存放不同类型的数据，适用于需要接收多种类型值的场景。' },
]

export const BUILTIN_LITERAL_COMPLETION_ITEMS: CompletionItem[] = [
  {
    name: '真',
    englishName: 'true',
    description: '逻辑真常量',
    returnType: '逻辑型',
    category: '常量',
    libraryName: '系统核心支持库',
    isMember: false,
    ownerTypeName: '',
    params: [],
  },
  {
    name: '假',
    englishName: 'false',
    description: '逻辑假常量',
    returnType: '逻辑型',
    category: '常量',
    libraryName: '系统核心支持库',
    isMember: false,
    ownerTypeName: '',
    params: [],
  },
  {
    name: '空',
    englishName: 'null',
    description: '空常量',
    returnType: '',
    category: '常量',
    libraryName: '系统核心支持库',
    isMember: false,
    ownerTypeName: '',
    params: [],
  },
]

export const AC_PAGE_SIZE = 30

export function formatOps(val: string): string {
  // 先替换为中文引号，再用占位符保护字符串字面量，避免后续运算符替换污染字符串内容。
  val = val.replace(/"([^"\r\n]*)"/g, '“$1”')
  const strPlaceholders: string[] = []
  let s = val.replace(/["“](.*?)["”]/g, (m) => {
    strPlaceholders.push(m)
    return `\x00STR${strPlaceholders.length - 1}\x00`
  })
  s = s.replace(/(<>|!=)/g, ' ≠ ')
  s = s.replace(/<=/g, ' ≤ ')
  s = s.replace(/>=/g, ' ≥ ')
  // 近似等于：?= 是它的同义写法（帮助如此）→ 归一成 ≈，顺带把空格规范成同其它运算符。
  // 必须先于下面的 = 规则，否则 ?= 里的 = 会先被换成 ＝，剩下个孤零零的 ?
  s = s.replace(/\?=|≈/g, ' ≈ ')
  s = s.replace(/＝/g, ' ＝ ')
  s = s.replace(/(?<!=)=(?!=)/g, ' ＝ ')
  s = s.replace(/</g, ' ＜ ')
  s = s.replace(/>/g, ' ＞ ')
  s = s.replace(/\+/g, ' ＋ ')
  s = s.replace(/(?<!\x00)-/g, ' － ')
  s = s.replace(/\*/g, ' × ')
  s = s.replace(/\//g, ' ÷ ')
  // 数组字面量与逗号间距规范（照易语言）：{ 元素, 元素 }——{ 后、} 前留空格，逗号后留空格
  s = s.replace(/｛/g, '{').replace(/｝/g, '}')
  s = s.replace(/\{\s*/g, '{ ')
  s = s.replace(/\s*\}/g, ' }')
  s = s.replace(/\s*[,，]\s*/g, ', ')
  // 收敛多余空格，保证失焦后的表达式展示稳定。
  s = s.replace(/ {2,}/g, ' ').trim()
  s = s.replace(/\x00STR(\d+)\x00/g, (_, idx) => strPlaceholders[parseInt(idx)])
  return s
}

/** 逻辑运算符别名（并且→且、或者→或）：着色按命令色处理，但它们是语言级运算符
 *（编译器直接转 &&/||，与命令目录无关），诊断不得按「未知命令」上报。 */
export const LOGIC_OPERATOR_ALIASES: ReadonlySet<string> = new Set(['且', '或'])

export function colorize(raw: string): Span[] {
  const trimmed = raw.replace(/[\r\t]/g, '')
  let stripped = trimmed.replace(/^ +/, '')
  const indent = trimmed.length - stripped.length
  // 流程标记行首可能带零宽字符，着色时先剥离再按普通语法处理。
  if (stripped.startsWith('\u200C') || stripped.startsWith('\u200D') || stripped.startsWith('\u2060')) {
    stripped = stripped.slice(1)
  }
  if (!stripped) return [{ text: '', cls: '' }]

  if (stripped.startsWith("'")) {
    return [
      ...(indent > 0 ? [{ text: '\u00A0'.repeat(indent), cls: '' }] : []),
      { text: stripped, cls: 'Remarkscolor' },
    ]
  }

  let code = stripped
  let remark = ''
  const ri = findRemark(stripped)
  if (ri >= 0) {
    code = stripped.slice(0, ri).trimEnd()
    remark = stripped.slice(ri)
  }

  const spans: Span[] = []

  if (indent > 0) {
    const lvl = Math.floor(indent / 4)
    for (let l = 0; l < lvl; l++) spans.push({ text: '\u2502\u00A0\u00A0\u00A0', cls: 'eTreeLine' })
    const ex = indent % 4
    if (ex > 0) spans.push({ text: '\u00A0'.repeat(ex), cls: '' })
  }

  if (code.startsWith('.')) {
    const kw = code.split(/[\s(（]/)[0]
    if (FLOW_KW.has(kw.slice(1))) {
      spans.push({ text: kw, cls: 'comecolor' })
      if (code.length > kw.length) spans.push(...colorExpr(code.slice(kw.length)))
    } else {
      spans.push(...colorExpr(code))
    }
  } else {
    const exprSpans = colorExpr(code)
    // 非 . 开头行在易语言里通常是命令调用；这里补齐“无括号调用”的着色判定。
    if (exprSpans.length > 0 && exprSpans[0].cls === '') {
      const firstText = exprSpans[0].text
      const m = firstText.match(/^([\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z_][\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_.]*)(.*)/)
      if (m) {
        const ident = m[1]
        const rest = m[2]
        // 找下一个非空白 span：格式化后的赋值行是 `变量 ＝ …`，标识符与 ＝ 之间隔着空格 span，
        // 只看紧邻 span 会漏判赋值目标（被当成无括号命令染成函数色）
        let nextIdx = 1
        while (nextIdx < exprSpans.length && exprSpans[nextIdx].cls === '' && exprSpans[nextIdx].text.trim() === '') nextIdx++
        const nextText = exprSpans[nextIdx]?.text || ''
        const isAssignTargetByRest = /^\s*[=＝]/.test(rest)
        const isAssignTargetByNext = /^\s*$/.test(rest) && /^\s*[=＝]/.test(nextText)
        if (isAssignTargetByRest || isAssignTargetByNext) {
          exprSpans.splice(0, 1, { text: ident, cls: 'assignTarget' }, ...(rest ? colorExpr(rest) : []))
        } else {
          exprSpans.splice(0, 1, { text: ident, cls: ident.includes('.') ? 'cometwolr' : 'funccolor' }, ...(rest ? colorExpr(rest) : []))
        }
      }
    }
    spans.push(...exprSpans)
  }

  if (remark) {
    spans.push({ text: ' ', cls: '' })
    spans.push({ text: remark, cls: 'Remarkscolor' })
  }
  return spans
}

function findRemark(s: string): number {
  let inS = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inS) {
      if (c === '"' || c === '\u201d') inS = false
      continue
    }
    if (c === '"' || c === '\u201c') {
      inS = true
      continue
    }
    if (c === "'" && i > 0) return i
  }
  return -1
}

function colorExpr(expr: string): Span[] {
  const out: Span[] = []
  let r = expr
  while (r.length > 0) {
    const ws = r.match(/^\s+/)
    if (ws) {
      out.push({ text: ws[0], cls: '' })
      r = r.slice(ws[0].length)
      continue
    }

    const op = r.match(/^(<>|!=|<=|>=|≠|≥|≤|≈|=|＝|<|>|＜|＞|\+|＋|-|－|\*|×|\/|÷|,|，)/)
    if (op) {
      out.push({ text: op[0], cls: 'eyc-punct' })
      r = r.slice(op[0].length)
      continue
    }

    const sm = r.match(/^([""\u201c])(.*?)([""\u201d])/)
    if (sm && r.startsWith(sm[1])) {
      out.push({ text: sm[0], cls: 'eTxtcolor' })
      r = r.slice(sm[0].length)
      continue
    }

    if (r.startsWith('#')) {
      const end = r.slice(1).search(/[\s(（），=＝<>+\-*\/]/)
      const cn = end >= 0 ? r.slice(0, end + 1) : r
      const cr = parseColorLiteralToColorref(cn)  // #hex / #名色 → 附色块
      out.push(cr !== null ? { text: cn, cls: 'conscolor', swatch: colorrefToHex(cr) } : { text: cn, cls: 'conscolor' })
      r = r.slice(cn.length)
      continue
    }

    // 词边界=后面不是标识符字符：半角 ,、) 等也算边界（如 数组排序 (排序数组, 真) 的 真）
    const bm = r.match(/^(真|假)(?=$|[^一-龥㐀-䶿가-힣぀-ヿA-Za-z0-9_])/)
    if (bm) {
      out.push({ text: bm[0], cls: 'conscolor' })
      r = r.slice(bm[0].length)
      continue
    }

    const lm = r.match(/^(且|或)(?=$|[^一-龥㐀-䶿가-힣぀-ヿA-Za-z0-9_])/)
    if (lm) {
      out.push({ text: lm[0], cls: 'funccolor' })
      r = r.slice(lm[0].length)
      continue
    }

    const flow = r.match(/^([\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z_][\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_.]*)(?=[\s(（），=＝<>+\-*\/]|$)/)
    if (flow && FLOW_KW.has(flow[1])) {
      out.push({ text: flow[1], cls: 'comecolor' })
      r = r.slice(flow[1].length)
      continue
    }

    if ('()（）{}[]'.includes(r[0])) {
      out.push({ text: r[0], cls: 'eyc-punct' })
      r = r.slice(1)
      continue
    }

    // rgb()/rgba() 颜色构造：名标 conscolor（勿落 funccolor，否则诊断误报未知命令），
    // 参数为纯数字字面量时附色块；名字消费后由后续迭代正常着色括号与参数。
    const rgbName = r.match(/^(rgba?)(?=\s*[(（])/i)
    if (rgbName) {
      const nm = rgbName[1]
      const argsM = r.slice(nm.length).match(/^\s*[(（]\s*(\d+)\s*[,，]\s*(\d+)\s*[,，]\s*(\d+)/)
      if (argsM) {
        const rr = Math.min(255, parseInt(argsM[1], 10)), gg = Math.min(255, parseInt(argsM[2], 10)), bb = Math.min(255, parseInt(argsM[3], 10))
        out.push({ text: nm, cls: 'conscolor', swatch: `#${((rr << 16) | (gg << 8) | bb).toString(16).padStart(6, '0')}` })
      } else {
        out.push({ text: nm, cls: 'conscolor' })
      }
      r = r.slice(nm.length)
      continue
    }

    // 仅在“标识符后紧跟括号”时按函数/成员调用着色。
    const fm = r.match(/^([\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z_][\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_.]*)\s*(?=[(\uff08])/)
    if (fm) {
      const name = fm[1]
      if (name.includes('.')) out.push({ text: name, cls: 'cometwolr' })
      else if (FLOW_KW.has(name)) out.push({ text: name, cls: 'comecolor' })
      else out.push({ text: name, cls: 'funccolor' })
      r = r.slice(name.length)
      continue
    }

    // 排除集必须含 ≈：否则没加空格的 `甲≈乙` 会被整段吞成一个普通 token，运算符切不出来
    const pm = r.match(/^[^""\u201c#()（）,，=＝<>＜＞≠≥≤≈+＋\-－*×\/÷\[\]{}\s]+/)
    if (pm) {
      out.push({ text: pm[0], cls: '' })
      r = r.slice(pm[0].length)
      continue
    }

    out.push({ text: r[0], cls: '' })
    r = r.slice(1)
  }

  return out
}

export function getMissingAssignmentRhsTarget(rawLine: string): string | null {
  const trimmed = rawLine.replace(/[\r\t]/g, '').trim()
  const m = /^([\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z_][\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_.]*)\s*(?:=|＝)\s*$/.exec(trimmed)
  return m ? m[1] : null
}

export function isKnownAssignmentTarget(target: string, knownVars: Set<string>): boolean {
  const normalized = (target || '').trim().replace(MEMBER_DELIMITER_REGEX, '.')
  if (!normalized) return false
  const base = normalized.split('.')[0]?.trim() || ''
  if (!base) return false
  return knownVars.has(base)
}

export function isValidVariableLikeName(name: string): boolean {
  return /^[\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z_]/.test(name.trim())
}

export function normalizeMemberTypeName(s: string): string {
  const t = (s || '').trim()
  if (!t) return ''
  const parts = t.split(/[.:]/).map(p => p.trim()).filter(Boolean)
  return (parts.length > 0 ? parts[parts.length - 1] : t).toLowerCase()
}

export function splitDebugRenderableText(text: string): Array<{ text: string; token?: string }> {
  if (!text) return [{ text }]
  const parts: Array<{ text: string; token?: string }> = []
  const regex = /([\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z_][\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_.]*)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push({ text: text.slice(lastIndex, match.index) })
    parts.push({ text: match[0], token: match[0] })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) parts.push({ text: text.slice(lastIndex) })
  return parts.length > 0 ? parts : [{ text }]
}

const DECL_PREFIXES = [
  '.程序集变量 ', '.程序集 ', '.子程序 ', '.局部变量 ',
  '.全局变量 ', '.常量 ', '.资源 ', '.数据类型 ', '.DLL命令 ',
  '.指针命令 ', '.图片 ', '.声音 ', '.参数 ', '.成员 ',
]

export function rebuildLineField(rawLine: string, fieldIdx: number, newValue: string, isSlice: boolean): string {
  const line = rawLine.replace(/\r/g, '')
  const stripped = line.replace(/^ +/, '')
  const indent = line.length - stripped.length

  for (const pf of DECL_PREFIXES) {
    if (stripped.startsWith(pf)) {
      const fieldsStr = stripped.slice(pf.length)
      const fields = splitCSV(fieldsStr)

      if (isSlice) {
        // slice 模式用于“从某字段起整体替换”，常见于参数串重建。
        fields.splice(fieldIdx, fields.length - fieldIdx, newValue)
      } else {
        while (fields.length <= fieldIdx) fields.push('')
        fields[fieldIdx] = newValue
      }

      while (fields.length > 0 && fields[fields.length - 1] === '') fields.pop()

      return ' '.repeat(indent) + pf + fields.join(', ')
    }
  }

  return rawLine
}

function parseFlagFieldTokens(rawValue: string): string[] {
  return (rawValue || '')
    .split(/[,\s]+/)
    .map(token => token.trim())
    .filter(Boolean)
}

export function rebuildLineFlagField(rawLine: string, fieldIdx: number, flag: string): string {
  const line = rawLine.replace(/\r/g, '')
  const stripped = line.replace(/^ +/, '')
  const indent = line.length - stripped.length

  for (const pf of DECL_PREFIXES) {
    if (!stripped.startsWith(pf)) continue
    const fieldsStr = stripped.slice(pf.length)
    const fields = splitCSV(fieldsStr)
    while (fields.length <= fieldIdx) fields.push('')
    const tokens = parseFlagFieldTokens(fields[fieldIdx] || '')
    const nextTokens = tokens.includes(flag)
      ? tokens.filter(token => token !== flag)
      : [...tokens, flag]
    fields[fieldIdx] = nextTokens.join(' ')
    while (fields.length > 0 && fields[fields.length - 1] === '') fields.pop()
    return ' '.repeat(indent) + pf + fields.join(', ')
  }

  return rawLine
}
