import { describe, expect, it } from 'vitest'
import { resolveMemberPropertyHintTarget } from '@/components/Editor/editorCoreUtils'

const controlTypes = new Map<string, string>([
  ['编辑框1', '编辑框'],
  ['进度条1', '进度条'],
])
const windowNames = ['_启动窗口', '设置窗口']

describe('resolveMemberPropertyHintTarget', () => {
  it('控件.成员 → __MEMBER__:控件类型:成员', () => {
    expect(resolveMemberPropertyHintTarget('编辑框1.内容', controlTypes, windowNames)).toBe('__MEMBER__:编辑框:内容')
    expect(resolveMemberPropertyHintTarget('进度条1.位置', controlTypes, windowNames)).toBe('__MEMBER__:进度条:位置')
  })

  it('窗口名.成员 → __MEMBER__:窗口:成员（赋值左值场景）', () => {
    expect(resolveMemberPropertyHintTarget('_启动窗口.底图', controlTypes, windowNames)).toBe('__MEMBER__:窗口:底图')
    expect(resolveMemberPropertyHintTarget('设置窗口.标题', controlTypes, windowNames)).toBe('__MEMBER__:窗口:标题')
  })

  it('成员段带尾括号（方法调用形式）不接管', () => {
    expect(resolveMemberPropertyHintTarget('编辑框1.加入文本(', controlTypes, windowNames)).toBeNull()
  })

  it('token 不含点 / 对象未知 → null（走既有命令提示路径）', () => {
    expect(resolveMemberPropertyHintTarget('调试输出', controlTypes, windowNames)).toBeNull()
    expect(resolveMemberPropertyHintTarget('未知对象.属性', controlTypes, windowNames)).toBeNull()
  })

  it('成员段不是合法标识符 → null', () => {
    expect(resolveMemberPropertyHintTarget('编辑框1.内容(1)', controlTypes, windowNames)).toBeNull()
    expect(resolveMemberPropertyHintTarget('编辑框1.', controlTypes, windowNames)).toBeNull()
  })

  it('容忍不换行空格与首尾空白', () => {
    expect(resolveMemberPropertyHintTarget('\u00A0_启动窗口.底图\u00A0', controlTypes, windowNames)).toBe('__MEMBER__:窗口:底图')
  })
})
