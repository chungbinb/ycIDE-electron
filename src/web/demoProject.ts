// 网页版（在线编辑器）的示例项目：首次打开时写入虚拟文件系统。
import { eycToYiFormat } from '../renderer/src/components/Editor/eycFormat'

export const DEMO_ROOT = 'C:\\ycIDE\\示例项目'
export const DEMO_EPP = `${DEMO_ROOT}\\示例项目.epp`

const efw = {
  type: 'window',
  name: '_启动窗口',
  title: 'ycIDE 在线体验',
  width: 420,
  height: 260,
  sourceFile: '_启动窗口.eyc',
  controls: [
    {
      id: 'ctl_label1', type: '标签', name: '标签1', left: 24, top: 24, width: 360, height: 24,
      text: '输入你的名字，然后点击「打招呼」：', visible: true, enabled: true, properties: {},
    },
    {
      id: 'ctl_edit1', type: '编辑框', name: '编辑框1', left: 24, top: 60, width: 250, height: 28,
      text: '易承', visible: true, enabled: true, properties: {},
    },
    {
      id: 'ctl_button1', type: '按钮', name: '按钮1', left: 288, top: 58, width: 96, height: 32,
      text: '打招呼', visible: true, enabled: true, properties: {},
    },
    {
      id: 'ctl_button2', type: '按钮', name: '按钮2', left: 288, top: 104, width: 96, height: 32,
      text: '算一算', visible: true, enabled: true, properties: {},
    },
  ],
}

const windowCode = `.版本 2
.程序集 窗口程序集_启动窗口

.子程序 _按钮1_被单击
.局部变量 名字, 文本型
名字 ＝ 编辑框1.内容
.如果 (名字 ＝ “”)
    信息框 (“请先输入名字”, 0, , )
.否则
    信息框 (问候语 (名字), 0, “ycIDE”, )
.如果结束

.子程序 _按钮2_被单击
信息框 (“1 加到 100 的和是：” ＋ 到文本 (求和 (100)), 0, , )
`

const moduleCode = `.版本 2
.程序集 公共函数

.子程序 问候语, 文本型, 公开, 根据名字和当前时间生成一句问候
.参数 名字, 文本型
.局部变量 小时, 整数型
小时 ＝ 取小时 (取现行时间 ())
.判断开始 (小时 ＜ 12)
    返回 (名字 ＋ “，上午好！”)
.判断 (小时 ＜ 18)
    返回 (名字 ＋ “，下午好！”)
.默认
    返回 (名字 ＋ “，晚上好！”)
.判断结束

.子程序 求和, 整数型, 公开, 计算 1 到 上限 的累加和
.参数 上限, 整数型
.局部变量 和, 整数型
.局部变量 i, 整数型
.计次循环首 (上限, i)
    和 ＝ 和 ＋ i
.计次循环尾 ()
返回 (和)
`

const globalVars = `.版本 2
.全局变量 访问次数, 整数型, , , 记录按钮被点击的次数
`

const epp = [
  '# YiCode Project File',
  'Version=1',
  'ProjectName=示例项目',
  'OutputType=WindowsApp',
  'Platform=windows',
  '',
  'File=EFW|_启动窗口.efw|1',
  'File=EYC|_启动窗口.eyc|0',
  'File=EYC|公共函数.eyc|0',
  'File=EGV|全局变量.egv|0',
].join('\n')

export const DEMO_FILES: Record<string, string> = {
  [DEMO_EPP]: epp,
  [`${DEMO_ROOT}\\_启动窗口.efw`]: JSON.stringify(efw, null, 2),
  // 源码按编辑器保存时的格式规整一遍，否则打开时会被误判为“文件已被外部修改”
  [`${DEMO_ROOT}\\_启动窗口.eyc`]: eycToYiFormat(windowCode),
  [`${DEMO_ROOT}\\公共函数.eyc`]: eycToYiFormat(moduleCode),
  [`${DEMO_ROOT}\\全局变量.egv`]: eycToYiFormat(globalVars),
}
