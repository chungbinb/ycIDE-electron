import { useEffect, useRef, useState } from 'react'

// 通用节流取色 input：系统取色器按住滑动会连发大量 onChange，若每次都同步做重活（主题全量重应用/整窗体更新+撤销序列化），
// 高频下会卡顿甚至崩溃。此组件滑动时本地即时预览（cheap），向父级的提交节流到 ~90ms 一次，
// 并用尾随 flush + 失焦 flush 保证最后一个颜色一定被提交。
type Props = { value: string; onChange: (v: string) => void } &
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>

export default function ThrottledColorInput({ value, onChange, ...rest }: Props): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  const pendRef = useRef<string | null>(null)
  const lastRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flush = (): void => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    if (pendRef.current !== null) { const v = pendRef.current; pendRef.current = null; lastRef.current = Date.now(); onChange(v) }
  }
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])
  const onSlide = (v: string): void => {
    setDraft(v); pendRef.current = v
    if (Date.now() - lastRef.current >= 90) flush()
    else if (!timerRef.current) timerRef.current = setTimeout(flush, 90)
  }
  return <input {...rest} type="color" value={draft} onChange={e => onSlide(e.target.value)} onBlur={flush} />
}
