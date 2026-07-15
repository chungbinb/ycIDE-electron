/**
 * 拼音匹配工具（基于 pinyin-pro）
 * 用于命令补全中将用户输入的拼音与中文命令名匹配
 */

import { pinyin } from 'pinyin-pro'

// 缓存已查询过的汉字读音，避免重复调用
const pinyinCache = new Map<string, string[]>()

/**
 * 获取一个汉字的**全部**读音（无声调、小写，首项为常用音）；非汉字 → 空数组。
 *
 * 【为什么必须取全部读音】此前只取 `[0]`（常用音），多音字就只认一个读法：
 * `换行符` 的「行」常用音是 xíng，于是只有 `hxf` 能匹配——可这个词里「行」实际读 háng，
 * 用户敲 `hhf`（正确读法！）反而匹配不上。补全匹配要的是宽容：任一读音命中即算命中。
 */
function getCharPinyins(ch: string): string[] {
  const cached = pinyinCache.get(ch)
  if (cached !== undefined) return cached
  let out: string[] = []
  if (/[\u4e00-\u9fff]/.test(ch)) {
    // 去重且保序（pinyin-pro 的首项是常用音）
    out = [...new Set(pinyin(ch, { toneType: 'none', multiple: true, type: 'array' }).filter(Boolean))]
  }
  pinyinCache.set(ch, out)
  return out
}

/** 一个汉字全部读音的首字母（去重）；非汉字 → 空数组 */
function getCharInitials(ch: string): string[] {
  const set = new Set<string>()
  for (const py of getCharPinyins(ch)) set.add(py[0])
  return [...set]
}

/**
 * 检查输入的拼音/文字是否匹配目标中文命令名
 *
 * 支持的匹配方式：
 * 1. 中文子串匹配
 * 2. 英文名前缀匹配 (不区分大小写)
 * 3. 拼音首字母匹配：如 "ts" 匹配 "调试输出"
 * 4. 拼音全拼前缀匹配：如 "tiao" 匹配 "调试"
 * 5. 混合匹配：如 "tiaos" 匹配 "调试"
 */
export function matchCommand(
  input: string,
  cmdName: string,
  cmdEnglishName: string
): boolean {
  if (!input) return false
  const lower = input.toLowerCase()

  // 1. 中文子串匹配
  if (cmdName.includes(input)) return true

  // 2. 英文名前缀匹配
  if (cmdEnglishName && cmdEnglishName.toLowerCase().startsWith(lower)) return true

  // 3. 中文+拼音混合顺序匹配
  if (mixedMatchCoverage(lower, cmdName) > 0) return true

  // 3-5. 拼音匹配
  return pinyinMatch(lower, cmdName)
}

/**
 * 拼音匹配：支持首字母、全拼、混合
 */
function pinyinMatch(input: string, target: string): boolean {
  if (!/^[a-z]+$/.test(input)) return false
  const chars = [...target]
  return matchFrom(input, 0, chars, 0)
}

function tokenizeMixedInput(input: string): string[] {
  const tokens: string[] = []
  let i = 0
  while (i < input.length) {
    const ch = input[i]
    if (/[a-z]/.test(ch)) {
      let j = i + 1
      while (j < input.length && /[a-z]/.test(input[j])) j++
      tokens.push(input.slice(i, j))
      i = j
      continue
    }
    tokens.push(ch)
    i++
  }
  return tokens
}

/**
 * 返回纯拼音 token 从 chars[cPos] 开始可匹配到的所有结束位置
 */
function pinyinTokenMatchEnds(token: string, chars: string[], cPos: number): number[] {
  const ends = new Set<number>()

  const dfs = (iPos: number, pos: number): void => {
    if (iPos >= token.length) {
      ends.add(pos)
      return
    }
    if (pos >= chars.length) return

    const ch = chars[pos]
    const pys = getCharPinyins(ch)

    if (pys.length === 0) {
      if (token[iPos] === ch.toLowerCase()) dfs(iPos + 1, pos + 1)
      return
    }

    // 首字母匹配（多音字：任一读音的首字母命中即可）
    if (getCharInitials(ch).includes(token[iPos])) dfs(iPos + 1, pos + 1)

    // 全拼前缀匹配（允许 1..py.length，支持如 "s" / "sh" / "shu"）——逐个读音试
    for (const py of pys) {
      for (let len = py.length; len >= 1; len--) {
        if (iPos + len <= token.length && token.slice(iPos, iPos + len) === py.slice(0, len)) {
          dfs(iPos + len, pos + 1)
        }
      }
    }
  }

  dfs(0, cPos)
  return [...ends].sort((a, b) => b - a)
}

/**
 * 混合匹配覆盖：支持“中文+拼音”交替输入。
 * 例如：整s / 整sh / 调s / tiao试 / 调shi / tiao试输
 */
function mixedMatchCoverage(input: string, target: string): number {
  if (!input) return -1
  const lower = input.toLowerCase()
  const tokens = tokenizeMixedInput(lower)
  if (tokens.length === 0) return -1

  const chars = [...target]
  const memo = new Map<string, number>()

  const dfs = (ti: number, cPos: number): number => {
    const key = `${ti}:${cPos}`
    const cached = memo.get(key)
    if (cached !== undefined) return cached

    if (ti >= tokens.length) return cPos
    if (cPos >= chars.length) return -1

    const token = tokens[ti]
    let best = -1

    if (/^[a-z]+$/.test(token)) {
      const ends = pinyinTokenMatchEnds(token, chars, cPos)
      for (const endPos of ends) {
        const r = dfs(ti + 1, endPos)
        if (r > best) best = r
      }
    } else {
      const ch = chars[cPos]
      if (token === ch || token === ch.toLowerCase()) {
        best = dfs(ti + 1, cPos + 1)
      }
    }

    memo.set(key, best)
    return best
  }

  return dfs(0, 0)
}

/**
 * 递归匹配：从 input[iPos] 开始，尝试匹配 chars[cPos] 开始的字符
 */
function matchFrom(input: string, iPos: number, chars: string[], cPos: number): boolean {
  if (iPos >= input.length) return true
  if (cPos >= chars.length) return false

  const ch = chars[cPos]
  const pys = getCharPinyins(ch)

  if (pys.length === 0) {
    if (ch.toLowerCase() === input[iPos]) {
      return matchFrom(input, iPos + 1, chars, cPos + 1)
    }
    return false
  }

  // 尝试首字母匹配（多音字：任一读音的首字母命中即可）
  if (getCharInitials(ch).includes(input[iPos])) {
    if (matchFrom(input, iPos + 1, chars, cPos + 1)) return true
  }

  // 尝试全拼前缀匹配（贪心）——逐个读音试
  for (const py of pys) {
    for (let len = py.length; len >= 2; len--) {
      if (iPos + len <= input.length && input.slice(iPos, iPos + len) === py.slice(0, len)) {
        if (matchFrom(input, iPos + len, chars, cPos + 1)) return true
      }
    }
  }

  return false
}

/**
 * 返回拼音匹配覆盖的目标字符数，-1 表示不匹配
 */
function pinyinMatchCoverage(input: string, target: string): number {
  if (!/^[a-z]+$/.test(input)) return -1
  const chars = [...target]
  return matchFromCoverage(input, 0, chars, 0)
}

function matchFromCoverage(input: string, iPos: number, chars: string[], cPos: number): number {
  if (iPos >= input.length) return cPos
  if (cPos >= chars.length) return -1

  const ch = chars[cPos]
  const pys = getCharPinyins(ch)

  if (pys.length === 0) {
    if (ch.toLowerCase() === input[iPos]) {
      return matchFromCoverage(input, iPos + 1, chars, cPos + 1)
    }
    return -1
  }

  // 尝试首字母匹配（多音字：任一读音的首字母命中即可）
  if (getCharInitials(ch).includes(input[iPos])) {
    const r = matchFromCoverage(input, iPos + 1, chars, cPos + 1)
    if (r >= 0) return r
  }

  // 尝试全拼前缀匹配（贪心）——逐个读音试
  for (const py of pys) {
    for (let len = py.length; len >= 2; len--) {
      if (iPos + len <= input.length && input.slice(iPos, iPos + len) === py.slice(0, len)) {
        const r = matchFromCoverage(input, iPos + len, chars, cPos + 1)
        if (r >= 0) return r
      }
    }
  }

  return -1
}

/**
 * 输入是否为 name 的「拼音首字母串」（逐字 1:1 对齐）。
 * 此前是把整名的首字母拼成一个串再 ===/startsWith——多音字只能取一个读法（`换行符` 恒为 hxf，
 * 敲 hhf 落空）。改成逐字比对：**任一读音的首字母命中即可**，且不匹配立即短路
 * （比原来每次按键对每个候选构整串更快，故不再需要 initialsCache）。
 */
function initialsMatch(input: string, name: string): 'exact' | 'prefix' | null {
  const chars = [...name]
  if (input.length > chars.length) return null
  for (let i = 0; i < input.length; i++) {
    const inits = getCharInitials(chars[i])
    const ok = inits.length > 0 ? inits.includes(input[i]) : chars[i].toLowerCase() === input[i]
    if (!ok) return null
  }
  return input.length === chars.length ? 'exact' : 'prefix'
}

/**
 * 拼音/混合匹配（mixedMatchCoverage / pinyinMatchCoverage）都从 cmdName 的
 * 第一个字符开始锚定匹配，先用 O(1) 首字符预检淘汰不可能命中的候选，
 * 避免对每个候选做 DFS。
 */
function canPinyinAnchorAtStart(lowerInput: string, cmdName: string): boolean {
  const f = lowerInput[0]
  const firstCp = cmdName.codePointAt(0)
  if (firstCp === undefined) return false
  const first = String.fromCodePoint(firstCp)
  if (/[a-z]/.test(f)) {
    const inits = getCharInitials(first)
    if (inits.length > 0) return inits.includes(f)
    return first.toLowerCase() === f
  }
  return first === f || first.toLowerCase() === f
}

/**
 * 计算匹配得分，用于排序（分数越高越靠前）
 */
export function matchScore(input: string, cmdName: string, cmdEnglishName: string): number {
  if (!input) return 0
  const lower = input.toLowerCase()

  // 中文精确匹配（最高优先级）
  if (cmdName === input) return 100
  if (cmdName.startsWith(input)) return 90
  if (cmdName.includes(input)) return 80

  // 拼音匹配（中优先级）。首字母串仅由 a-z 组成，输入不含小写字母时不可能命中。
  if (/[a-z]/.test(lower)) {
    const m = initialsMatch(lower, cmdName)
    if (m === 'exact') return 70
    if (m === 'prefix') return 65
  }

  if (canPinyinAnchorAtStart(lower, cmdName)) {
    const mixedConsumed = mixedMatchCoverage(lower, cmdName)
    if (mixedConsumed > 0) {
      const targetLen = [...cmdName].length
      if (mixedConsumed >= targetLen) return 69
      if (mixedConsumed / targetLen >= 0.5) return 60
      return 54
    }

    if (/^[a-z]+$/.test(lower)) {
      const targetLen = [...cmdName].length
      const consumed = pinyinMatchCoverage(lower, cmdName)
      if (consumed > 0) {
        if (consumed >= targetLen) return 68
        if (consumed / targetLen >= 0.5) return 58
        return 52
      }
    }
  }

  // 英文匹配（低优先级）
  if (cmdEnglishName) {
    const engLower = cmdEnglishName.toLowerCase()
    if (engLower === lower) return 45
    if (engLower.startsWith(lower)) return 42
    if (engLower.includes(lower)) return 38
  }

  return 0
}

/**
 * 判断匹配是否通过英文名称命中
 */
export function isEnglishMatch(input: string, cmdEnglishName: string): boolean {
  if (!input || !cmdEnglishName) return false
  const lower = input.toLowerCase()
  return cmdEnglishName.toLowerCase().includes(lower)
}
