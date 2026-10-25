// 项目管理器搜索框：按名称过滤项目树，保留通往命中项的各级节点
import { describe, it, expect } from 'vitest'
import { filterProjectTree, splitLabelByQuery, parseProjectTreeQuery } from '@/components/Sidebar/projectTreeFilter'

const tree = [
  {
    id: 'root', label: '我的项目', children: [
      {
        id: 'mods', label: '程序集', children: [
          { id: 'm1', label: '窗口程序集_启动窗口', children: [
            { id: 's1', label: '__启动窗口_创建完毕' },
            { id: 's2', label: '_按钮1_被单击' },
          ] },
          { id: 'm2', label: '工具模块', children: [
            { id: 's3', label: '取文件名' },
            { id: 's4', label: 'ReadFile' },
          ] },
        ],
      },
      { id: 'res', label: '资源', children: [{ id: 'r1', label: '图片1' }] },
    ],
  },
]

describe('项目管理器搜索', () => {
  it('空查询原样返回', () => {
    const r = filterProjectTree(tree, '  ')
    expect(r.nodes).toBe(tree)
    expect(r.matchCount).toBe(0)
  })

  it('只保留命中项及其祖先，并展开祖先', () => {
    const r = filterProjectTree(tree, '文件')
    expect(r.matchCount).toBe(1)
    const mods = r.nodes[0].children!
    expect(mods.map(n => n.id)).toEqual(['mods'])
    expect(mods[0].children!.map(n => n.id)).toEqual(['m2'])
    expect(mods[0].children![0].children!.map(n => n.id)).toEqual(['s3'])
    expect([...r.expandIds].sort()).toEqual(['m2', 'mods', 'root'])
  })

  it('不区分大小写，多个关键词须全部命中', () => {
    expect(filterProjectTree(tree, 'readfile').matchCount).toBe(1)
    expect(filterProjectTree(tree, '启动 创建').matchCount).toBe(1)
    expect(filterProjectTree(tree, '启动 不存在').nodes).toEqual([])
  })

  it('命中的程序集保留全部子程序，但不强制展开', () => {
    const r = filterProjectTree(tree, '工具模块')
    const m2 = r.nodes[0].children![0].children![0]
    expect(m2.children!.map(n => n.id)).toEqual(['s3', 's4'])
    expect(r.expandIds.has('m2')).toBe(false)
  })

  it('高亮切分命中片段', () => {
    expect(splitLabelByQuery('_按钮1_被单击', parseProjectTreeQuery('按钮'))).toEqual([
      { text: '_', hit: false }, { text: '按钮', hit: true }, { text: '1_被单击', hit: false },
    ])
    expect(splitLabelByQuery('ReadFile', ['file'])).toEqual([{ text: 'Read', hit: false }, { text: 'File', hit: true }])
  })
})
