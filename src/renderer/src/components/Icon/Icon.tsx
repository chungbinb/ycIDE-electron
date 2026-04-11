/**
 * SVG Icon component using VS 2022 Image Library icons.
 * Normalizes SVG colors to currentColor so icon tint follows theme tokens.
 */

// Toolbar icons
import NewDocumentSvg from '../../assets/icons/NewDocument.svg?raw'
import OpenFolderSvg from '../../assets/icons/OpenFolder.svg?raw'
import SaveSvg from '../../assets/icons/Save.svg?raw'
import UndoSvg from '../../assets/icons/Undo.svg?raw'
import RedoSvg from '../../assets/icons/Redo.svg?raw'
import RunSvg from '../../assets/icons/Run.svg?raw'
import LibrarySvg from '../../assets/icons/Library.svg?raw'
import ToolboxSvg from '../../assets/icons/Toolbox.svg?raw'
import CollapseLeftSvg from '../../assets/icons/CollapseLeft.svg?raw'
import ExpandRightSvg from '../../assets/icons/ExpandRight.svg?raw'
import ZoomSvg from '../../assets/icons/Zoom.svg?raw'
import BranchSvg from '../../assets/icons/Branch.svg?raw'
import ExtensionApplicationSvg from '../../assets/icons/ExtensionApplication.svg?raw'
import UserSvg from '../../assets/icons/User.svg?raw'
import FieldSvg from '../../assets/icons/Field.svg?raw'
import MeasureTreeSvg from '../../assets/icons/MeasureTree.svg?raw'
import ConePreviewSvg from '../../assets/icons/ConePreview.svg?raw'

// Debug icons
import StopSvg from '../../assets/icons/Stop.svg?raw'
import PauseSvg from '../../assets/icons/Pause.svg?raw'
import StepIntoSvg from '../../assets/icons/StepInto.svg?raw'
import StepOverSvg from '../../assets/icons/StepOver.svg?raw'
import StepOutSvg from '../../assets/icons/StepOut.svg?raw'
import GoToCurrentLineSvg from '../../assets/icons/GoToCurrentLine.svg?raw'

// Alignment icons
import AlignLeftSvg from '../../assets/icons/AlignLeft.svg?raw'
import AlignRightSvg from '../../assets/icons/AlignRight.svg?raw'
import AlignTopSvg from '../../assets/icons/AlignTop.svg?raw'
import AlignBottomSvg from '../../assets/icons/AlignBottom.svg?raw'
import CenterHorizontallySvg from '../../assets/icons/CenterHorizontally.svg?raw'
import CenterVerticallySvg from '../../assets/icons/CenterVertically.svg?raw'
import AlignHorizontalStretchSvg from '../../assets/icons/AlignHorizontalStretch.svg?raw'
import AlignVerticalStretchSvg from '../../assets/icons/AlignVerticalStretch.svg?raw'
import MakeSameHeightSvg from '../../assets/icons/MakeSameHeight.svg?raw'

// Tree / sidebar icons
import FolderClosedSvg from '../../assets/icons/FolderClosed.svg?raw'
import FolderOpenedSvg from '../../assets/icons/FolderOpened.svg?raw'
import ModuleSvg from '../../assets/icons/Module.svg?raw'
import MethodSvg from '../../assets/icons/Method.svg?raw'
import WindowsFormSvg from '../../assets/icons/WindowsForm.svg?raw'
import ProcedureSvg from '../../assets/icons/Procedure.svg?raw'
import ClassSvg from '../../assets/icons/Class.svg?raw'
import DocumentCollectionSvg from '../../assets/icons/DocumentCollection.svg?raw'
import EventSvg from '../../assets/icons/Event.svg?raw'
import PropertySvg from '../../assets/icons/Property.svg?raw'

// Toolbox / control icons
import TextBoxSvg from '../../assets/icons/TextBox.svg?raw'
import LabelSvg from '../../assets/icons/Label.svg?raw'
import ListBoxSvg from '../../assets/icons/ListBox.svg?raw'
import GroupBoxSvg from '../../assets/icons/GroupBox.svg?raw'
import ProgressBarSvg from '../../assets/icons/ProgressBar.svg?raw'
import TimerSvg from '../../assets/icons/Timer.svg?raw'
import RadioButtonSvg from '../../assets/icons/RadioButton.svg?raw'
import MonthCalendarSvg from '../../assets/icons/MonthCalendar.svg?raw'
import DateTimePickerSvg from '../../assets/icons/DateTimePicker.svg?raw'
import SliderSvg from '../../assets/icons/Slider.svg?raw'
import TabSvg from '../../assets/icons/Tab.svg?raw'
import MutuallExclusiveCheckboxSvg from '../../assets/icons/MutuallExclusiveCheckbox.svg?raw'
import ImageButtonSvg from '../../assets/icons/ImageButton.svg?raw'
import CursorSvg from '../../assets/icons/Cursor.svg?raw'
import HorizontalScrollBarSvg from '../../assets/icons/HorizontalScrollBar.svg?raw'
import VerticalScrollBarSvg from '../../assets/icons/VerticalScrollBar.svg?raw'
import DataGridSvg from '../../assets/icons/DataGrid.svg?raw'
import DataSourceSvg from '../../assets/icons/DataSource.svg?raw'
import SerialPortSvg from '../../assets/icons/SerialPort.svg?raw'
import ServerSvg from '../../assets/icons/Server.svg?raw'
import CustomControlSvg from '../../assets/icons/CustomControl.svg?raw'
import SelectObjectSvg from '../../assets/icons/SelectObject.svg?raw'
import DialogSvg from '../../assets/icons/Dialog.svg?raw'
import PanelSvg from '../../assets/icons/Panel.svg?raw'
import NetworkSvg from '../../assets/icons/Network.svg?raw'
import ImageSvg from '../../assets/icons/Image.svg?raw'
import ColorPickerSvg from '../../assets/icons/ColorPicker.svg?raw'
import SpinnerSvg from '../../assets/icons/Spinner.svg?raw'
import HyperLinkSvg from '../../assets/icons/HyperLink.svg?raw'
import EditSvg from '../../assets/icons/Edit.svg?raw'

/** Icon name registry */
export const ICON_MAP: Record<string, string> = {
  // Toolbar
  'new-document': NewDocumentSvg,
  'open-folder': OpenFolderSvg,
  'save': SaveSvg,
  'undo': UndoSvg,
  'redo': RedoSvg,
  'run': RunSvg,
  'stop': StopSvg,
  'pause': PauseSvg,
  'step-into': StepIntoSvg,
  'step-over': StepOverSvg,
  'step-out': StepOutSvg,
  'run-to-cursor': GoToCurrentLineSvg,
  'library': LibrarySvg,
  'toolbox': ToolboxSvg,
  'collapse-left': CollapseLeftSvg,
  'expand-right': ExpandRightSvg,
  'search': ZoomSvg,
  'source-control': BranchSvg,
  'extension': ExtensionApplicationSvg,
  'account': UserSvg,
  'dll-command': MeasureTreeSvg,

  // Alignment
  'align-left': AlignLeftSvg,
  'align-right': AlignRightSvg,
  'align-top': AlignTopSvg,
  'align-bottom': AlignBottomSvg,
  'center-h': CenterHorizontallySvg,
  'center-v': CenterVerticallySvg,
  'same-width': AlignHorizontalStretchSvg,
  'same-height': AlignVerticalStretchSvg,
  'same-size': MakeSameHeightSvg,

  // Tree
  'folder-closed': FolderClosedSvg,
  'folder-opened': FolderOpenedSvg,
  'module': ModuleSvg,
  'method': MethodSvg,
  'windows-form': WindowsFormSvg,
  'procedure': ProcedureSvg,
  'class': ClassSvg,
  'field': FieldSvg,
  'dll': MeasureTreeSvg,
  'constant': ConePreviewSvg,
  'resource-view': DocumentCollectionSvg,
  'event': EventSvg,
  'property': PropertySvg,

  // Toolbox controls
  'textbox': TextBoxSvg,
  'label': LabelSvg,
  'listbox': ListBoxSvg,
  'groupbox': GroupBoxSvg,
  'progressbar': ProgressBarSvg,
  'timer': TimerSvg,
  'radiobutton': RadioButtonSvg,
  'month-calendar': MonthCalendarSvg,
  'date-picker': DateTimePickerSvg,
  'slider': SliderSvg,
  'tab': TabSvg,
  'checkbox': MutuallExclusiveCheckboxSvg,
  'image-button': ImageButtonSvg,
  'cursor': CursorSvg,
  'hscrollbar': HorizontalScrollBarSvg,
  'vscrollbar': VerticalScrollBarSvg,
  'datagrid': DataGridSvg,
  'datasource': DataSourceSvg,
  'serialport': SerialPortSvg,
  'server': ServerSvg,
  'custom-control': CustomControlSvg,
  'select-object': SelectObjectSvg,
  'dialog': DialogSvg,
  'panel': PanelSvg,
  'network': NetworkSvg,
  'image': ImageSvg,
  'color-picker': ColorPickerSvg,
  'spinner': SpinnerSvg,
  'hyperlink': HyperLinkSvg,
  'edit': EditSvg,
}

function stripSvgTitle(raw: string): string {
  return raw.replace(/<title[\s\S]*?<\/title>/gi, '')
}

/**
 * Scope SVG internal CSS class names with a unique prefix to prevent
 * collisions when multiple SVGs are inlined in the same document.
 */
function scopeSvgStyles(svgHtml: string, scope: string): string {
  // Prefix class names in <style> block: .className → .scope__className
  // Use (?!\d) to avoid matching decimal numbers like 0.1 in "opacity: 0.1"
  svgHtml = svgHtml.replace(/<style>([\s\S]*?)<\/style>/gi, (_match, css: string) => {
    const scopedCss = css.replace(/\.(?!\d)([\w-]+)/g, `.${scope}__$1`)
    return `<style>${scopedCss}</style>`
  })
  // Prefix class names in element attributes: class="cls1 cls2" → class="scope__cls1 scope__cls2"
  svgHtml = svgHtml.replace(/\bclass="([^"]*)"/gi, (_match, classes: string) => {
    const scopedClasses = classes.trim().split(/\s+/).filter(Boolean).map(c => `${scope}__${c}`).join(' ')
    return `class="${scopedClasses}"`
  })
  return svgHtml
}

/** Normalize svg color declarations so tint follows currentColor */
function normalizeSvgColor(raw: string, scope: string): string {
  return scopeSvgStyles(
    stripSvgTitle(raw)
      .replace(/\s(fill|stroke)="(?!none|currentColor)[^"]*"/gi, ' $1="currentColor"')
      .replace(/(fill|stroke)\s*:\s*(?!none|currentColor)[^;"]+/gi, '$1: currentColor'),
    scope
  )
}

/** Default grey colors used by VS 2022 light-variant SVGs for structural elements */
const DEFAULT_GREY_PATTERN = /#(?:212121|1e1e1e|252526|2d2d2d|1f1f1f)\b/gi

/**
 * Replace only default grey fills/strokes with currentColor, keeping accent colors intact.
 * This lets structural parts follow theme color while colored accents (blue, yellow, red, green) remain.
 */
function normalizeGreyOnly(raw: string, scope: string): string {
  return scopeSvgStyles(
    stripSvgTitle(raw)
      .replace(/\s(fill|stroke)="(#(?:212121|1e1e1e|252526|2d2d2d|1f1f1f))"/gi, ' $1="currentColor"')
      .replace(/(fill|stroke)\s*:\s*(#(?:212121|1e1e1e|252526|2d2d2d|1f1f1f))\s*([;"])/gi, '$1: currentColor$3'),
    scope
  )
}

/** Cache processed SVG strings keyed by "name_mode" */
const _svgCache = new Map<string, string>()

export type IconColorMode = 'themed' | 'original' | 'preserve-accent'

interface IconProps {
  name: string
  size?: number
  className?: string
  style?: React.CSSProperties
  title?: string
  preserveOriginalColors?: boolean
  /** Icon color mode: 'themed' = all→currentColor, 'original' = keep all, 'preserve-accent' = grey→currentColor + keep accents */
  colorMode?: IconColorMode
}

export default function Icon({ name, size = 16, className = '', style, title, preserveOriginalColors = false, colorMode }: IconProps): React.JSX.Element | null {
  const raw = ICON_MAP[name]
  if (!raw) return null
  const effectiveMode: IconColorMode = colorMode ?? (preserveOriginalColors ? 'original' : 'themed')
  const cacheKey = `${name}_${effectiveMode}`
  let processedSvg = _svgCache.get(cacheKey)
  if (!processedSvg) {
    switch (effectiveMode) {
      case 'original':
        processedSvg = scopeSvgStyles(stripSvgTitle(raw), name)
        break
      case 'preserve-accent':
        processedSvg = normalizeGreyOnly(raw, name)
        break
      default:
        processedSvg = normalizeSvgColor(raw, name)
        break
    }
    _svgCache.set(cacheKey, processedSvg)
  }
  return (
    <span
      className={`vs-icon ${className}`}
      style={{ width: size, height: size, ...style }}
      title={title}
      aria-label={title}
      dangerouslySetInnerHTML={{ __html: processedSvg }}
    />
  )
}

/**
 * Map a 易语言 component type name to an icon name for the toolbox.
 */
export const UNIT_ICON_MAP: Record<string, string> = {
  '窗口': 'windows-form',
  '按钮': 'image-button',
  '编辑框': 'textbox',
  '标签': 'label',
  '图片框': 'image',
  '列表框': 'listbox',
  '组合框': 'listbox',
  '选择框': 'checkbox',
  '单选框': 'radiobutton',
  '分组框': 'groupbox',
  '进度条': 'progressbar',
  '时钟': 'timer',
  '选择列表框': 'listbox',
  '横向滚动条': 'hscrollbar',
  '纵向滚动条': 'vscrollbar',
  '通用对话框': 'dialog',
  '画板': 'panel',
  '超级列表框': 'datagrid',
  '选择夹': 'tab',
  '影像框': 'image',
  '日期框': 'date-picker',
  '月历': 'month-calendar',
  '驱动器框': 'custom-control',
  '目录框': 'folder-closed',
  '文件框': 'custom-control',
  '颜色选择器': 'color-picker',
  '超级编辑框': 'edit',
  '状态条': 'custom-control',
  '工具条': 'toolbox',
  '树型框': 'custom-control',
  '数据报表': 'datagrid',
  '图片组': 'image',
  '外形框': 'custom-control',
  '超级链接框': 'hyperlink',
  '调节器': 'spinner',
  '滑块条': 'slider',
  '数据报': 'network',
  '客户': 'network',
  '服务器': 'server',
  '端口': 'serialport',
  '表格': 'datagrid',
  '数据源': 'datasource',
  '图形按钮': 'image-button',
  '打印机': 'custom-control',
  '通用提供者': 'custom-control',
  '数据库提供者': 'datasource',
  '外部数据库': 'datasource',
  '外部数据提供者': 'datasource',
}
