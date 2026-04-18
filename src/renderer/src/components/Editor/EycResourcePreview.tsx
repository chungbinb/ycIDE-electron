import type { ReactElement } from 'react'
import closeIcon from '../../assets/icons/Close.svg'
import { formatDateTime, formatDuration, formatFileSize } from './editorResourceFormatUtils'

export interface ResourcePreviewState {
  visible: boolean
  lineIndex: number
  resourceName: string
  resourceFile: string
  resourceType: string
  version: number
}

export interface ResourcePreviewMeta {
  mime: string
  ext: string
  filePath: string
  sizeBytes: number
  modifiedAtMs: number
}

export interface ResourcePreviewMediaMeta {
  width?: number
  height?: number
  durationSec?: number
}

interface EycResourcePreviewProps {
  preview: ResourcePreviewState
  previewBusy: boolean
  previewSrc: string
  previewMsg: string
  previewMeta: ResourcePreviewMeta | null
  previewMediaMeta: ResourcePreviewMediaMeta
  projectDir?: string
  onClose: () => void
  onReplace: () => void
  onImageLoaded: (width: number, height: number) => void
  onAudioLoaded: (durationSec?: number) => void
  onVideoLoaded: (width: number, height: number, durationSec?: number) => void
  inferResourceTypeByFileName: (fileName: string) => string
}

export default function EycResourcePreview({
  preview,
  previewBusy,
  previewSrc,
  previewMsg,
  previewMeta,
  previewMediaMeta,
  projectDir,
  onClose,
  onReplace,
  onImageLoaded,
  onAudioLoaded,
  onVideoLoaded,
  inferResourceTypeByFileName,
}: EycResourcePreviewProps): ReactElement | null {
  if (!preview.visible) return null

  const viewType = preview.resourceType || inferResourceTypeByFileName(preview.resourceFile)
  const isImage = viewType === '图片'
  const isAudio = viewType === '声音'
  const isVideo = viewType === '视频'

  return (
    <div className="eyc-resource-preview-overlay" onClick={onClose}>
      <div className="eyc-resource-preview-modal" onClick={(e) => e.stopPropagation()}>
        <div className="eyc-resource-preview-header">
          <div className="eyc-resource-preview-title">资源预览</div>
          <button
            type="button"
            className="eyc-resource-preview-close"
            aria-label="关闭预览"
            title="关闭"
            onClick={onClose}
          >
            <img className="eyc-resource-preview-close-icon" src={closeIcon} alt="" aria-hidden="true" />
          </button>
        </div>
        <div className="eyc-resource-preview-meta">
          <div>资源名称：{preview.resourceName || '（未命名）'}</div>
          <div>资源类型：{viewType || '其它'}</div>
          <div>文件扩展名：{previewMeta?.ext ? `.${previewMeta.ext}` : '未知'}</div>
          <div>MIME：{previewMeta?.mime || '未知'}</div>
          <div>文件大小：{previewMeta ? formatFileSize(previewMeta.sizeBytes) : '加载中...'}</div>
          <div>修改时间：{previewMeta ? formatDateTime(previewMeta.modifiedAtMs) : '加载中...'}</div>
          {!!previewMediaMeta.width && !!previewMediaMeta.height && (
            <div>分辨率：{previewMediaMeta.width} × {previewMediaMeta.height}</div>
          )}
          {Number.isFinite(previewMediaMeta.durationSec) && (
            <div>时长：{formatDuration(previewMediaMeta.durationSec as number)}</div>
          )}
          <div className="eyc-resource-preview-path">资源路径：{previewMeta?.filePath || (projectDir ? `${projectDir}\\${preview.resourceFile}` : preview.resourceFile)}</div>
        </div>
        <div className="eyc-resource-preview-body">
          {!!previewSrc && isImage && <img className="eyc-resource-preview-image" src={previewSrc} alt={preview.resourceFile} onLoad={(e) => {
            onImageLoaded(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)
          }} />}
          {!!previewSrc && isAudio && <audio className="eyc-resource-preview-audio" src={previewSrc} controls onLoadedMetadata={(e) => {
            const duration = e.currentTarget.duration
            onAudioLoaded(Number.isFinite(duration) ? duration : undefined)
          }} />}
          {!!previewSrc && isVideo && <video className="eyc-resource-preview-video" src={previewSrc} controls onLoadedMetadata={(e) => {
            const width = e.currentTarget.videoWidth
            const height = e.currentTarget.videoHeight
            const duration = e.currentTarget.duration
            onVideoLoaded(width, height, Number.isFinite(duration) ? duration : undefined)
          }} />}
          {!previewSrc && <div className="eyc-resource-preview-empty">{previewMsg || '当前资源类型暂不支持内嵌预览，可使用“更换文件”来替换资源。'}</div>}
        </div>
        <div className="eyc-resource-preview-footer">
          <button className="eyc-resource-preview-replace" onClick={onReplace} disabled={previewBusy || !projectDir}>
            {previewBusy ? '更换中...' : '更换文件'}
          </button>
        </div>
      </div>
    </div>
  )
}
