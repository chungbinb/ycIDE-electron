import { execFile } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { extname, isAbsolute, join, resolve } from 'node:path'
import type { CompileMessage, CompileResult } from './compiler'
import type { LibraryWindowUnit } from './libraryManager'
import { getEuiBuildTools, getMsvcEnvironment } from './euiBuildTools'
import { EUI_WINDOW_UI_PROVIDER } from '../shared/plugin/windowUiProviders'
import { euiControlEvents, euiRuntimeControlType, findWindowControlUnit } from '../shared/plugin/windowControls'

export interface EuiProjectInput {
  projectName: string
  projectDir: string
  files: Array<{ type: string; fileName: string; flag: number }>
}
interface EuiControlInput {
  name: string; type: string; typeId?: string; libraryId?: string
  left?: number; top?: number; x?: number; y?: number; width: number; height: number
  text?: string; visible?: boolean; enabled?: boolean; properties?: Record<string, unknown>
}
export interface EuiFormInput {
  name: string; title: string; width: number; height: number; sourceFile?: string
  properties?: Record<string, unknown>; controls: EuiControlInput[]; menu?: unknown[]
}
export interface EuiUserCode {
  sources: string[]
  definitions: string
  handlers: Array<{ name: string; params: number; returnType: string }>
}

const cpp = (value: string) => JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
const cmakePath = (value: string) => `"${value.replace(/\\/g, '/').replace(/\$/g, '\\$').replace(/;/g, '\\;').replace(/"/g, '\\"')}"`
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function isEuiForm(value: unknown): value is EuiFormInput {
  if (!record(value) || typeof value.name !== 'string' || typeof value.title !== 'string' ||
    typeof value.width !== 'number' || typeof value.height !== 'number' || !Array.isArray(value.controls)) return false
  if (value.sourceFile !== undefined && typeof value.sourceFile !== 'string') return false
  if (value.properties !== undefined && !record(value.properties)) return false
  if (value.menu !== undefined && !Array.isArray(value.menu)) return false
  return value.controls.every(control => record(control) && typeof control.name === 'string' && typeof control.type === 'string' &&
    typeof control.width === 'number' && typeof control.height === 'number' &&
    ['left', 'top', 'x', 'y'].every(key => control[key] === undefined || typeof control[key] === 'number' && Number.isFinite(control[key])) &&
    (control.text === undefined || typeof control.text === 'string') &&
    (control.properties === undefined || record(control.properties)) &&
    ['visible', 'enabled'].every(key => control[key] === undefined || typeof control[key] === 'boolean'))
}

export function readEuiForms(project: EuiProjectInput, units: LibraryWindowUnit[], editorFiles?: Map<string, string>): EuiFormInput[] {
  const names = new Set<string>()
  return project.files.filter(file => file.type === 'EFW').map(file => {
    const raw: unknown = JSON.parse(editorFiles?.get(file.fileName) ?? readFileSync(join(project.projectDir, file.fileName), 'utf8'))
    if (!isEuiForm(raw)) throw new Error(`${file.fileName} 不是有效的 EUI 窗口文件（名称、标题、尺寸或控件字段无效）`)
    const form = raw
    const validSize = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 32768
    if (!form.name || names.has(form.name) || !validSize(form.width) || !validSize(form.height)) throw new Error(`${file.fileName} 的窗口名称或尺寸无效/重复`)
    names.add(form.name)
    if (form.menu?.length) throw new Error('EUI 实验后端暂不支持窗口菜单，不能忽略菜单继续构建')
    for (const control of form.controls) {
      if (!control.name || names.has(control.name)) throw new Error(`EUI 当前要求项目级唯一控件名称：${control.name}`)
      names.add(control.name)
      const unit = control.libraryId && control.typeId ? findWindowControlUnit(units, control) : undefined
      const runtimeType = unit && euiRuntimeControlType(unit)
      if (!unit || !runtimeType) throw new Error(`控件 ${control.name} 不兼容 EUI 或缺少稳定类型标识/运行适配：${control.type}`)
      if (!validSize(control.width) || !validSize(control.height)) throw new Error(`控件 ${control.name} 的尺寸无效`)
      for (const [name, value] of Object.entries(control.properties ?? {})) {
        const property = unit.properties.find(property => property.name === name)
        if (!property) throw new Error(`EUI 控件 ${control.name} 尚不支持属性「${name}」`)
        const supported: Record<string, string[]> = {
          EuiButton: ['标题'], EuiInput: ['内容', '是否允许多行'], EuiLabel: ['标题'], EuiImage: ['图片'],
          EuiCheckbox: ['标题', '选中'], EuiRadio: ['标题', '选中'],
          EuiSlider: ['最小位置', '最大位置', '位置'], EuiProgress: ['最小位置', '最大位置', '位置'],
          EuiGroup: ['标题'], EuiWebView: ['地址'], EuiWebButton: ['标题'], EuiWebEdit: ['内容'],
          EuiScript: ['语言', '超时'],
          Win32Button: ['标题'], Win32Label: ['标题'], Win32Edit: ['内容', '是否允许多行'],
          Win32Checkbox: ['标题', '选中'], Win32Radio: ['标题', '选中'],
          Win32Slider: ['最小位置', '最大位置', '位置'], Win32Progress: ['最小位置', '最大位置', '位置'],
          Win32Group: ['标题'], Win32Image: ['图片'],
        }
        const commonProperties = runtimeType === 'EuiScript' ? [] : ['左边', '顶边', '宽度', '高度', '可视', '禁止']
        if (![...commonProperties, ...(supported[runtimeType] ?? [])].includes(name)) throw new Error(`控件 ${control.name} 的设计期属性「${name}」尚无 ${runtimeType} 初始化适配，不能忽略后继续编译`)
        if ((property.typeName === '文本型' && typeof value !== 'string') ||
          (property.typeName === '逻辑型' && typeof value !== 'boolean') ||
          (property.typeName === '整数型' && (typeof value !== 'number' || !Number.isInteger(value)))) throw new Error(`控件 ${control.name} 属性「${name}」的类型无效`)
        if (['宽度', '高度'].includes(name) && !validSize(value)) throw new Error(`控件 ${control.name} 的尺寸属性无效`)
        if (runtimeType === 'EuiScript' && name === '语言' && !['JScript', 'VBScript'].includes(String(value))) throw new Error(`脚本组件 ${control.name} 的语言必须为 JScript 或 VBScript`)
        if (runtimeType === 'EuiScript' && name === '超时' && (Number(value) < -2147483648 || Number(value) > 2147483647)) throw new Error(`脚本组件 ${control.name} 的超时超出 32 位整数范围`)
        if (['EuiCheckbox', 'EuiRadio', 'Win32Checkbox', 'Win32Radio'].includes(runtimeType) && name === '选中' && typeof value !== 'boolean') throw new Error(`控件 ${control.name} 的选中属性必须为逻辑值`)
        if (['EuiSlider', 'EuiProgress', 'Win32Slider', 'Win32Progress'].includes(runtimeType) && ['最小位置', '最大位置', '位置'].includes(name) &&
          (typeof value !== 'number' || !Number.isInteger(value) || value < -2147483648 || value > 2147483647)) throw new Error(`控件 ${control.name} 的范围属性必须为 32 位整数`)
        if (runtimeType === 'EuiWebView' && name === '地址' && String(value) && !/^(https?:\/\/|about:blank$)/i.test(String(value))) throw new Error(`浏览框 ${control.name} 仅支持 http(s):// 地址或 about:blank`)
      }
      if (['EuiSlider', 'EuiProgress', 'Win32Slider', 'Win32Progress'].includes(runtimeType)) {
        const minimum = Number(control.properties?.['最小位置'] ?? 0)
        const maximum = Number(control.properties?.['最大位置'] ?? 100)
        const value = Number(control.properties?.['位置'] ?? minimum)
        if (minimum >= maximum || value < minimum || value > maximum) throw new Error(`控件 ${control.name} 的最小位置、最大位置或当前位置无效`)
      }
    }
    const windowUnit = units.find(unit => unit.topLevel && unit.uiProviders?.includes(EUI_WINDOW_UI_PROVIDER))
    for (const [name, value] of Object.entries(form.properties ?? {})) {
      const property = windowUnit?.properties.find(property => property.name === name)
      if (!property) throw new Error(`EUI 窗口尚不支持属性「${name}」`)
      if ((property.typeName === '文本型' && typeof value !== 'string') ||
        (property.typeName === '逻辑型' && typeof value !== 'boolean') ||
        (['宽度', '高度'].includes(name) && !validSize(value))) throw new Error(`EUI 窗口属性「${name}」的类型或尺寸无效`)
    }
    return form
  })
}

export function generateEuiMain(forms: EuiFormInput[], units: LibraryWindowUnit[], code: EuiUserCode, startup: number): string {
  const declarations = new Set<string>()
  const handler = (name: string) => {
    const found = code.handlers.find(handler => handler.name === name)
    if (!found) return '{}'
    if (found.params || found.returnType) throw new Error(`EUI 事件 ${name} 必须无参数、无返回值`)
    declarations.add(`extern void ${name}();`)
    return name
  }
  const definitions = forms.map(form => {
    const controls = form.controls.map(control => {
      const unit = findWindowControlUnit(units, control)
      const runtimeType = unit && euiRuntimeControlType(unit)
      if (!unit || !runtimeType) throw new Error(`没有注册兼容 EUI 的控件运行适配：${control.libraryId}/${control.typeId}`)
      const event = euiControlEvents(unit)[0]
      const callback = event ? handler(`_${control.name}_${event.name}`) : '{}'
      const text = String(control.properties?.['标题'] ?? control.properties?.['内容'] ?? control.properties?.['地址'] ?? control.properties?.['图片'] ?? control.text ?? '')
      const properties = control.properties ?? {}
      const isRadio = runtimeType === 'EuiRadio' || runtimeType === 'Win32Radio'
      const radioGroup = isRadio ? (() => {
        const left = control.left ?? control.x ?? Number(properties['左边'] ?? 0)
        const top = control.top ?? control.y ?? Number(properties['顶边'] ?? 0)
        const groups = form.controls.filter(candidate => {
          const unit = findWindowControlUnit(units, candidate)
          if (!unit || !['EuiGroup', 'Win32Group'].includes(euiRuntimeControlType(unit) ?? '')) return false
          const x = candidate.left ?? candidate.x ?? Number(candidate.properties?.['左边'] ?? 0)
          const y = candidate.top ?? candidate.y ?? Number(candidate.properties?.['顶边'] ?? 0)
          const width = Number(candidate.properties?.['宽度'] ?? candidate.width)
          const height = Number(candidate.properties?.['高度'] ?? candidate.height)
          return left >= x && top >= y && left + control.width <= x + width && top + control.height <= y + height
        }).sort((a, b) => a.width * a.height - b.width * b.height)
        return groups[0]?.name ?? `${form.name}.radio`
      })() : ''
      const minimum = Number(properties['最小位置'] ?? 0)
      const maximum = Number(properties['最大位置'] ?? 100)
      const value = Number(properties['位置'] ?? minimum)
      let initialize = '{}'
      let dispose = '{}'
      if (runtimeType === 'EuiScript') {
        declarations.add('extern "C" void script_set_text(const wchar_t*, int, const wchar_t*);')
        declarations.add('extern "C" void script_set_int(const wchar_t*, int, long long);')
        declarations.add('extern "C" void script_dispose(const wchar_t*);')
        const name = `L${cpp(control.name)}`
        initialize = `[] { script_dispose(${name}); script_set_text(${name}, 0, L${cpp(String(properties['语言'] ?? 'JScript'))}); script_set_int(${name}, 2, ${properties['超时'] ?? 0}); }`
        dispose = `[] { script_dispose(${name}); }`
      }
      return `{${cpp(control.name)},${cpp(runtimeType)},${cpp(text)},${cpp(radioGroup)},${cpp(text)},${properties['左边'] ?? control.left ?? control.x ?? 0},${properties['顶边'] ?? control.top ?? control.y ?? 0},${properties['宽度'] ?? control.width},${properties['高度'] ?? control.height},${value},${minimum},${maximum},${properties['可视'] ?? control.visible !== false},${properties['禁止'] ?? control.enabled === false},${properties['是否允许多行'] === true},${properties['选中'] === true},nullptr,${10000 + startup * 1000 + forms.indexOf(form) * 1000 + form.controls.indexOf(control)},${callback},${initialize},${dispose}}`
    })
    return `{${cpp(form.name)},${cpp(String(form.properties?.['标题'] ?? form.title))},${form.properties?.['宽度'] ?? form.width},${form.properties?.['高度'] ?? form.height},${form.properties?.['深色主题'] === true},false,{${controls.join(',\n')}},${handler(`_${form.name}_创建完毕`)}}`
  })
  return `#include "runtime.h"
#include <windows.h>
${declarations.size ? [...declarations].join('\n') : ''}
${code.definitions}
namespace {
void initializeForms() {
  if (!yc_eui::forms().empty()) return;
  yc_eui::forms() = {${definitions.join(',\n')}};
}
std::string utf8(const wchar_t* text) {
  if (!text || !*text) return {};
  int size = WideCharToMultiByte(CP_UTF8, 0, text, -1, nullptr, 0, nullptr, nullptr);
  if (size <= 0) yc_eui::fail("Invalid window name");
  std::string value(size, '\\0');
  WideCharToMultiByte(CP_UTF8, 0, text, -1, value.data(), size, nullptr, nullptr);
  value.pop_back();
  return value;
}
}
extern "C" int eui_OpenWindow(const char* name, bool modal) {
  initializeForms();
  const std::string wanted(name ? name : "");
  for (std::size_t index = 0; index < yc_eui::forms().size(); ++index) {
    auto& form = yc_eui::forms()[index];
    if (form.name != wanted) continue;
    if (form.pending) return 1;
    if (yc_eui::isOpen(form)) { glfwShowWindow(form.handle); return 1; }
    form.created = false;
    form.pending = true;
    form.modal = modal;
    form.owner = &yc_eui::forms().at(${startup});
    app::openWindow(app::DslWindowConfig{}.title(form.title).pageId(form.name).windowSize(form.width, yc_eui::outerHeight(form.height)).modal(modal != 0),
      [index](eui::Ui& ui, const eui::Screen& screen) { yc_eui::composeForm(index, ui, screen); });
    return 1;
  }
  yc_eui::fail("Unknown EUI window: " + wanted);
  return 0;
}
int yc_win_load(const wchar_t* name, const wchar_t* parent, int modal) {
  if (modal) yc_eui::fail("Synchronous modal loading is unavailable. Use EUI OpenWindow for explicit asynchronous modality.");
  if (parent && *parent && utf8(parent) != yc_eui::forms().at(${startup}).name) yc_eui::fail("Only the main EUI window can own a child window.");
  return eui_OpenWindow(utf8(name).c_str(), false);
}
void yc_win_destroy(const wchar_t* name) {
  const auto wanted = utf8(name);
  for (auto& form : yc_eui::forms()) if (form.name == wanted && yc_eui::isOpen(form)) {
    glfwSetWindowShouldClose(form.handle, GLFW_TRUE);
    app::requestUpdate();
    return;
  }
  yc_eui::fail("EUI window is not loaded: " + wanted);
}
namespace app {
const DslAppConfig& dslAppConfig() {
  initializeForms();
  const auto& form = yc_eui::forms().at(${startup});
  static const DslAppConfig config = DslAppConfig{}.title(form.title).pageId(form.name)
    .windowSize(form.width, yc_eui::outerHeight(form.height)).decorated(false).highDpi().iconPath("").showDebugStatsInTitle(false).showDebugOverlay(false);
  return config;
}
void compose(eui::Ui& ui, const eui::Screen& screen) { yc_eui::composeForm(${startup}, ui, screen); }
}
`
}

export async function buildEuiProject(
  project: EuiProjectInput, appDir: string, units: LibraryWindowUnit[],
  generateUserCode: (forms: EuiFormInput[], temp: string) => EuiUserCode,
  emit: (message: CompileMessage) => void, editorFiles?: Map<string, string>, previewWindow?: string,
): Promise<CompileResult> {
  const started = Date.now()
  const tools = getEuiBuildTools(appDir)
  const forms = readEuiForms(project, units, editorFiles)
  if (!forms.length) throw new Error('EUI 窗口项目至少需要一个 .efw')
  const startupFile = project.files.find(file => file.type === 'EFW' && file.flag === 1)?.fileName
  const wanted = previewWindow || startupFile
  const startup = wanted ? project.files.filter(file => file.type === 'EFW').findIndex((file, index) =>
    file.fileName === wanted || forms[index].name === wanted) : 0
  if (startup < 0) throw new Error(`找不到 EUI 启动窗口：${wanted}`)
  const temp = join(project.projectDir, 'temp', 'eui')
  const output = join(project.projectDir, 'output', 'windows', 'x64')
  const staging = join(temp, 'staging')
  mkdirSync(temp, { recursive: true })
  mkdirSync(output, { recursive: true })
  mkdirSync(staging, { recursive: true })
  const stagedImages = join(staging, 'assets', 'project-images')
  rmSync(stagedImages, { recursive: true, force: true })
  let imageIndex = 0
  for (const form of forms) for (const control of form.controls) {
    const unit = findWindowControlUnit(units, control)
    if (!unit || !['EuiImage', 'Win32Image'].includes(euiRuntimeControlType(unit) ?? '')) continue
    const source = String(control.properties?.['图片'] ?? control.text ?? '')
    if (!source) continue
    const data = /^data:image\/(png|jpeg|gif|bmp|webp|svg\+xml);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(source)
    if (source.startsWith('data:') && !data) throw new Error(`图片 ${control.name} 的内嵌格式无效`)
    const extension = data ? ({ jpeg: '.jpg', 'svg+xml': '.svg' }[data[1]] || `.${data[1]}`) : extname(source).toLowerCase()
    if (!['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'].includes(extension)) throw new Error(`不支持的 EUI 图片格式：${extension}`)
    const relativePath = `assets/project-images/image-${imageIndex++}${extension}`
    const destination = join(staging, relativePath)
    mkdirSync(stagedImages, { recursive: true })
    if (data) {
      const buffer = Buffer.from(data[2], 'base64')
      if (!buffer.length || buffer.length > 50 * 1024 * 1024) throw new Error('EUI 图片为空或超过 50 MiB')
      writeFileSync(destination, buffer)
    } else {
      const file = isAbsolute(source) ? source : resolve(project.projectDir, source)
      if (statSync(file).size > 50 * 1024 * 1024) throw new Error('EUI 图片超过 50 MiB')
      copyFileSync(file, destination)
    }
    control.properties = { ...control.properties, 图片: relativePath }
  }
  const code = generateUserCode(forms, temp)
  writeFileSync(join(temp, 'main.cpp'), generateEuiMain(forms, units, code, startup), 'utf8')
  const libraryDir = join(appDir, 'lib', 'eui')
  const webViewLibraryDir = join(appDir, 'lib', 'webview2')
  const hasWebView = forms.some(form => form.controls.some(control => {
    const unit = findWindowControlUnit(units, control)
    return !!unit && euiRuntimeControlType(unit) === 'EuiWebView'
  }))
  const sources = ['main.cpp', ...code.sources, ...(hasWebView ? [join(webViewLibraryDir, 'impl', 'windows.cpp')] : [])].map(cmakePath).join('\n')
  const includeDirectories = [libraryDir, ...(hasWebView ? [join(webViewLibraryDir, 'include')] : [])].map(cmakePath).join(' ')
  writeFileSync(join(temp, 'CMakeLists.txt'), `cmake_minimum_required(VERSION 3.24)
project(ycide_eui LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
find_package(EuiNeo 0.6.3 EXACT CONFIG REQUIRED)
if(NOT EUI_NEO_WINDOW_BACKEND STREQUAL "glfw" OR NOT EUI_NEO_RENDER_BACKEND STREQUAL "opengl")
  message(FATAL_ERROR "The current EUI adapter requires GLFW + OpenGL.")
endif()
add_executable(ycide_app ${sources} ${cmakePath(join(libraryDir, 'runtime.cpp'))})
target_include_directories(ycide_app PRIVATE ${includeDirectories})
target_compile_definitions(ycide_app PRIVATE NOMINMAX WIN32_LEAN_AND_MEAN _CRT_SECURE_NO_WARNINGS${hasWebView ? ' YC_EUI_HAS_WEBVIEW2' : ''})
target_compile_options(ycide_app PRIVATE /utf-8 /Gy /Gw)
target_link_options(ycide_app PRIVATE /OPT:REF)
target_link_libraries(ycide_app PRIVATE user32 gdi32 comctl32 oleaut32 advapi32 ole32 gdiplus comdlg32 shell32 ws2_32)
set_target_properties(ycide_app PROPERTIES OUTPUT_NAME ${cmakePath(project.projectName)} RUNTIME_OUTPUT_DIRECTORY_RELEASE ${cmakePath(staging)})
eui_neo_configure_app(ycide_app)
`, 'utf8')
  const env = getMsvcEnvironment(tools.vcvars)
  const execute = (args: string[]) => new Promise<void>((complete, fail) => {
    execFile(tools.cmake, args, { env, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      for (const text of [stdout, stderr]) if (text.trim()) emit({ type: error ? 'error' : 'info', text: text.trim() })
      if (error) fail(new Error(`EUI / MSVC 构建失败：${error.message}`))
      else complete()
    })
  })
  emit({ type: 'warning', text: 'EUI 实验后端：当前仅 Windows x64；尚无系统读屏桥接，断点调试未开放。' })
  await execute(['-S', temp, '-B', join(temp, 'build'), '-A', 'x64', `-DCMAKE_PREFIX_PATH=${tools.sdk}`])
  await execute(['--build', join(temp, 'build'), '--config', 'Release'])
  const outputFile = join(output, `${project.projectName}.exe`)
  const stagedBinary = join(staging, `${project.projectName}.exe`)
  if (!existsSync(stagedBinary)) throw new Error('EUI 构建结束但没有生成可执行文件')
  copyFileSync(stagedBinary, outputFile)
  rmSync(join(output, 'assets', 'project-images'), { recursive: true, force: true })
  if (existsSync(join(staging, 'assets'))) cpSync(join(staging, 'assets'), join(output, 'assets'), { recursive: true })
  emit({ type: 'success', text: `EUI 窗口编译成功：${outputFile}` })
  return { success: true, outputFile, errorCount: 0, warningCount: 1, elapsedMs: Date.now() - started }
}
