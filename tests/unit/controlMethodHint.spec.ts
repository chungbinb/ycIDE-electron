// 点击控件方法（编辑框.加入文本 等）提示面板：此前库命令目录查不到 → 显示"未在已加载的支持库中找到此命令"+空参数。
// 修复=App.handleCommandClick 未命中库命令时查 CONTROL_TYPE_METHODS 补出签名。此处测其解析器。
import { describe, it, expect } from 'vitest'
import { resolveControlMethodDetail, findControlMethodCompletion } from '../../src/renderer/src/components/Editor/editorCoreUtils'

describe('控件方法提示解析', () => {
  it('加入文本 → 编辑框方法，带「欲加入文本(文本型)」参数（非空参数、非未找到）', () => {
    const d = resolveControlMethodDetail('加入文本')
    expect(d).not.toBeNull()
    expect(d!.name).toBe('加入文本')
    expect(d!.returnType).toBe('无返回值')
    expect(d!.category).toBe('控件方法')
    expect(d!.libraryName).toContain('编辑框')
    expect(d!.params).toHaveLength(1)
    expect(d!.params[0]).toMatchObject({ name: '欲加入文本', type: '文本型', optional: false, isVariable: false, isArray: false })
  })

  it('加入项目 → 命中列表族控件，含「文本+可选数值」两参', () => {
    const d = resolveControlMethodDetail('加入项目')
    expect(d).not.toBeNull()
    expect(d!.params.length).toBeGreaterThanOrEqual(1)
    expect(d!.params[0].type).toBe('文本型')
  })

  it('未知方法 / 空名 → null（交回原「未找到」兜底）', () => {
    expect(resolveControlMethodDetail('压根不存在的方法')).toBeNull()
    expect(resolveControlMethodDetail('')).toBeNull()
  })

  it('带对象前缀也认（编辑框1.加入文本 → 剥前缀查方法名）', () => {
    expect(resolveControlMethodDetail('编辑框1.加入文本')?.name).toBe('加入文本')
    expect(findControlMethodCompletion('编辑框1.加入文本')?.name).toBe('加入文本')
  })
})

// 参数展开按钮：表格编辑器靠「这行的命令有参数」判定是否画 +/- 展开按钮，
// 库命令/DLL/项目类方法之外还需认控件方法，否则 编辑框1.加入文本(a) 行不出展开按钮。
describe('控件方法补全项（参数展开用）', () => {
  it('加入文本 → CompletionItem，params 非空才会画展开按钮', () => {
    const c = findControlMethodCompletion('加入文本')
    expect(c).not.toBeNull()
    expect(c!.name).toBe('加入文本')
    expect(c!.params.length).toBeGreaterThan(0)          // >0 是出展开按钮的前提
    expect(c!.params[0].name).toBe('欲加入文本')
    expect(c!.params[0].type).toBe('文本型')
    expect(c!.isMember).toBe(true)
    expect(c!.ownerTypeName).toBe('编辑框')
  })

  it('未知方法 → null（不误画展开按钮）', () => {
    expect(findControlMethodCompletion('压根不存在的方法')).toBeNull()
    expect(findControlMethodCompletion('')).toBeNull()
  })
})
