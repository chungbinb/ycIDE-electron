// 项目管理器"未调用子程序"标记的判定逻辑。
//
// 全项目文本级判定：收集所有源码文件（.eyc/.ecc，二者在 .epp 里同为 EYC 类型）里
// 声明的子程序名，再对声明行之外的全部代码做标识符分词，声明过但从未作为
// 标识符出现的子程序即视为"未被调用"。
//
// 设计取舍（宁可漏标、不可误标）：
// - 以 _ 开头的子程序（_启动子程序、_按钮1_被单击 等事件处理/入口约定）由运行时
//   按名调用，源码里可能没有显式调用点，一律不参与判定。
// - 用标识符分词而非子串匹配："求和" 不会被 "求和2" 的出现误判为已使用；
//   类方法 "对象.方法名(...)" 中方法名会被正确分出。
// - 注释/字符串中出现同名标识符也算"已使用"——接受这种保守性。
// - 子程序在自身代码里递归调用自己也算"已使用"。

const SUB_DECL_RE = /^\s*\.子程序\s+([^,\s]+)/
const IDENT_TOKEN_RE = /[0-9A-Za-z_一-龥]+/g

export function computeUnusedSubNames(sourceContents: Iterable<string>): Set<string> {
  const declared = new Set<string>()
  const usedTokens = new Set<string>()
  for (const content of sourceContents) {
    for (const rawLine of (content || '').split('\n')) {
      const m = SUB_DECL_RE.exec(rawLine)
      if (m) {
        const name = (m[1] || '').trim()
        if (name) declared.add(name)
        continue // 声明行本身的名字不算调用
      }
      for (const token of rawLine.match(IDENT_TOKEN_RE) || []) usedTokens.add(token)
    }
  }
  const unused = new Set<string>()
  for (const name of declared) {
    if (name.startsWith('_')) continue
    if (!usedTokens.has(name)) unused.add(name)
  }
  return unused
}
