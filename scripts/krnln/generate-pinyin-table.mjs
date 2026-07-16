// 生成「拼音处理」类命令（取所有发音/取发音数目/取拼音/取声母/取韵母）共用的国标汉字拼音表。
// 产物：lib/krnln/impl/pinyin-table.inc（由 impl/windows.cpp #include 进去）。
//
// 为什么单独一个文件：表有 6763 条、约 150KB，塞进 windows.cpp 会让这个手写文件一半是数据噪音。
// 支持库源码是**原地编译**的（compiler.ts 直接 args.push(lib.libraryPath)），故同级 #include 能解析；
// 打包侧 scripts/package-libraries.mjs 用 walkFiles 递归整个 lib/ 目录，新文件自动进包。
//
// 汉字集：按帮助的「目前仅支持国标汉字」取 GB2312。**注意 iconv-lite 的 'gb2312' 实际走 GBK**
// （整个 U+4E00..U+9FA5 都能往返，会得到 20902 字而非 6763），故必须按 GB2312 的字节范围判定。
// 数据源 pinyin-pro（已是项目依赖，渲染进程的命令补全在用），multiple:true 取多音字，首项为常用音。
//
// 用法：node scripts/krnln/generate-pinyin-table.mjs
// 改动后记得同步 libraryManager.ts 里 impl/pinyin-table.inc 的 SHA。
import { writeFileSync } from 'node:fs'
import { pinyin } from 'pinyin-pro'
import iconv from 'iconv-lite'

const OUT = 'lib/krnln/impl/pinyin-table.inc'

/**
 * 是否国标（GB2312）汉字。GB2312 汉字区：首字节 0xB0-0xF7、次字节 0xA1-0xFE
 * （一级字 3755 个 + 二级字 3008 个 = 6763）。GBK 在此之外还有大量扩展字，不算国标。
 */
function isGb2312Hanzi(ch) {
  const buf = iconv.encode(ch, 'gbk')
  if (buf.length !== 2) return false
  const b1 = buf[0], b2 = buf[1]
  if (b1 < 0xb0 || b1 > 0xf7 || b2 < 0xa1 || b2 > 0xfe) return false
  return iconv.decode(buf, 'gbk') === ch    // 防不可映射时退化成 '?'
}

const entries = []
let multiCount = 0
for (let cp = 0x4e00; cp <= 0x9fa5; cp++) {
  const ch = String.fromCodePoint(cp)
  if (!isGb2312Hanzi(ch)) continue
  const all = pinyin(ch, { toneType: 'none', multiple: true, type: 'array' })
  const uniq = [...new Set(all.filter(Boolean))]   // 去重保序：首项=常用音
  if (uniq.length === 0) continue
  if (uniq.length > 1) multiCount++
  entries.push({ cp, py: uniq.join(',') })
}
entries.sort((a, b) => a.cp - b.cp)               // 二分查找要求按码位升序

const out = [
  '// 【自动生成，请勿手工编辑】国标(GB2312)汉字 → 全部拼音编码。',
  '// 重新生成：node scripts/krnln/generate-pinyin-table.mjs（改完同步 libraryManager.ts 的 SHA）',
  '//',
  `// 共 ${entries.length} 字（GB2312 一级 3755 + 二级 3008 = 6763），其中多音字 ${multiCount} 个。`,
  '// py 为无声调小写拼音、多音以逗号分隔，首项是常用音（帮助：「多音字的第一个发音为常用音」）。',
  '// 表按码位升序排列 —— ycPinyinOf() 依赖此不变量做二分查找。',
  'struct YcPinyinEntry { unsigned short ch; const char* py; };',
  'static const YcPinyinEntry g_ycPinyinTable[] = {',
  ...entries.map(e => `    { 0x${e.cp.toString(16).toUpperCase()}, "${e.py}" },`),
  '};',
  `static const int g_ycPinyinTableCount = ${entries.length};`,
  '',
].join('\n')

writeFileSync(OUT, out, 'utf-8')
console.log(`已生成 ${OUT}`)
console.log(`  国标汉字 ${entries.length} 字，多音字 ${multiCount} 个，${(out.length / 1024).toFixed(1)} KB`)
if (entries.length !== 6763) console.log(`  ⚠ 预期 6763 字，实得 ${entries.length} —— 检查 GB2312 判定`)
