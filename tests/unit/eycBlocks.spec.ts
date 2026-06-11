import { describe, it, expect } from 'vitest'
import { splitCSV, unquote, inferResourceTypeByFileName, parseLines, buildBlocks } from '@/components/Editor/eycBlocks'

describe('splitCSV', () => {
  it('按「逗号+空格」分隔字段', () => {
    expect(splitCSV('计数, 整数型, , 备注')).toEqual(['计数', '整数型', '', '备注'])
  })

  it('引号内的分隔符不拆分', () => {
    expect(splitCSV('"a, b", 整数型')).toEqual(['"a, b"', '整数型'])
  })

  it('不带空格的逗号不作为分隔符（与易语言字段格式一致）', () => {
    expect(splitCSV('a,b, c')).toEqual(['a,b', 'c'])
  })

  it('空字符串返回单个空字段', () => {
    expect(splitCSV('')).toEqual([''])
  })

  it('行尾裸逗号视为分隔符，不并入字段', () => {
    expect(splitCSV('指针命令1,')).toEqual(['指针命令1', ''])
    expect(splitCSV('a, b,')).toEqual(['a', 'b', ''])
  })
})

describe('unquote', () => {
  it('剥离半角与全角引号', () => {
    expect(unquote('"你好"')).toBe('你好')
    expect(unquote('“你好”')).toBe('你好')
  })

  it('非引号包裹原样返回', () => {
    expect(unquote('你好')).toBe('你好')
    expect(unquote('')).toBe('')
  })
})

describe('inferResourceTypeByFileName', () => {
  it('按扩展名识别资源类型', () => {
    expect(inferResourceTypeByFileName('logo.PNG')).toBe('图片')
    expect(inferResourceTypeByFileName('bgm.mp3')).toBe('声音')
    expect(inferResourceTypeByFileName('intro.mp4')).toBe('视频')
    expect(inferResourceTypeByFileName('data.bin')).toBe('其它')
    expect(inferResourceTypeByFileName('')).toBe('其它')
  })
})

describe('parseLines', () => {
  it('识别版本、支持库、注释、空行', () => {
    const lines = parseLines(".版本 2\n.支持库 spec\n' 这是注释\n")
    expect(lines[0].type).toBe('version')
    expect(lines[1].type).toBe('supportLib')
    expect(lines[1].fields).toEqual(['spec'])
    expect(lines[2].type).toBe('comment')
    expect(lines[3].type).toBe('blank')
  })

  it('识别声明行并拆分字段', () => {
    const lines = parseLines('.子程序 启动, 整数型\n.局部变量 计数, 整数型\n')
    expect(lines[0].type).toBe('sub')
    expect(lines[0].fields).toEqual(['启动', '整数型'])
    expect(lines[1].type).toBe('localVar')
    expect(lines[1].fields).toEqual(['计数', '整数型'])
  })

  it('识别带缩进的参数行', () => {
    const lines = parseLines('    .参数 名称, 文本型')
    expect(lines[0].type).toBe('subParam')
    expect(lines[0].fields).toEqual(['名称', '文本型'])
  })

  it('其余行视为代码行', () => {
    const lines = parseLines('输出调试文本 ("ok")')
    expect(lines[0].type).toBe('code')
  })

  it('识别 DLL命令 与 指针命令 声明行', () => {
    const lines = parseLines('.DLL命令 取API, 长整数型, "sciter.dll", "SciterAPI"\n.指针命令 Sciter取版本, 整数型, 公开, 取主版本号\n')
    expect(lines[0].type).toBe('dll')
    expect(lines[0].fields).toEqual(['取API', '长整数型', '"sciter.dll"', '"SciterAPI"'])
    expect(lines[1].type).toBe('ptrCmd')
    expect(lines[1].fields).toEqual(['Sciter取版本', '整数型', '公开', '取主版本号'])
  })
})

describe('buildBlocks（指针命令表格）', () => {
  it('指针命令生成独立表格并携带参数行', () => {
    const text = '.版本 2\n.指针命令 Sciter取版本, 整数型, , 备注文字\n    .参数 主版本, 逻辑型\n'
    const blocks = buildBlocks(text)
    const tbl = blocks.find(b => b.kind === 'table' && b.tableType === 'ptrcmd')
    expect(tbl).toBeTruthy()
    const dataRow = tbl!.rows.find(r => !r.isHeader && r.cells[0]?.text === 'Sciter取版本')
    expect(dataRow).toBeTruthy()
    expect(dataRow!.cells[1].text).toBe('整数型')
    expect(dataRow!.cells[3].text).toBe('备注文字')
    const paramRow = tbl!.rows.find(r => !r.isHeader && r.cells[0]?.text === '主版本')
    expect(paramRow).toBeTruthy()
    expect(paramRow!.cells[1].text).toBe('逻辑型')
  })

  it('指针命令的公开标记渲染为勾选', () => {
    const blocks = buildBlocks('.指针命令 调用回调, , 公开\n')
    const tbl = blocks.find(b => b.kind === 'table' && b.tableType === 'ptrcmd')
    const dataRow = tbl!.rows.find(r => !r.isHeader && r.cells[0]?.text === '调用回调')
    expect(dataRow!.cells[2].text).toBe('√')
  })

  it('行尾带裸逗号的旧声明行名称不带逗号（回归：新建指针命令显示“指针命令1,”）', () => {
    const blocks = buildBlocks('.版本 2\n.指针命令 指针命令1,\n')
    const tbl = blocks.find(b => b.kind === 'table' && b.tableType === 'ptrcmd')
    const dataRow = tbl!.rows.find(r => !r.isHeader)
    expect(dataRow!.cells[0].text).toBe('指针命令1')
  })
})
