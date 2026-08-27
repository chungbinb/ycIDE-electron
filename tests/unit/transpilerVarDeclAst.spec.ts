// 变量声明 AST 测试
import { describe, it, expect } from 'vitest'
import {
  parseVarDeclFromLine,
  parseArrayDimsField,
  type EycVarDecl,
} from '../../src/main/transpiler/varDeclAst'

describe('varDeclAst', () => {
  describe('parseArrayDimsField', () => {
    it('空字段 → 非数组', () => {
      expect(parseArrayDimsField(undefined)).toEqual({ dims: [], isArray: false })
      expect(parseArrayDimsField('')).toEqual({ dims: [], isArray: false })
    })

    it('单维数组', () => {
      const result = parseArrayDimsField('601')
      expect(result.isArray).toBe(true)
      expect(result.dims).toEqual([601])
    })

    it('多维数组', () => {
      const result = parseArrayDimsField('3,4')
      expect(result.isArray).toBe(true)
      expect(result.dims).toEqual([3, 4])
    })

    it('无效维度 → 错误信息', () => {
      const result = parseArrayDimsField('-1')
      expect(result.isArray).toBe(false)
      expect(result.invalid).toBeDefined()
    })
  })

  describe('parseLocalVarDecl', () => {
    it('简单局部变量', () => {
      const decl = parseVarDeclFromLine('.局部变量 结果, 整数型', 5)
      expect(decl?.kind).toBe('localVar')
      if (decl?.kind === 'localVar') {
        expect(decl.name).toBe('结果')
        expect(decl.type).toBe('整数型')
        expect(decl.isArray).toBe(false)
      }
    })

    it('数组局部变量', () => {
      const decl = parseVarDeclFromLine('.局部变量 数组 1, 整数型,, 601', 10)
      expect(decl?.kind).toBe('localVar')
      if (decl?.kind === 'localVar' && decl.isArray) {
        expect(decl.dims).toEqual([601])
      }
    })
  })

  describe('parseGlobalVarDecl', () => {
    it('全局变量', () => {
      const decl = parseVarDeclFromLine('.全局变量 全局计数, 长整数型', 1)
      expect(decl?.kind).toBe('globalVar')
      if (decl?.kind === 'globalVar') {
        expect(decl.name).toBe('全局计数')
        expect(decl.type).toBe('长整数型')
      }
    })
  })

  describe('parseParamDecl', () => {
    it('简单参数', () => {
      const decl = parseVarDeclFromLine('.参数 文本, 文本型', 3)
      expect(decl?.kind).toBe('param')
      if (decl?.kind === 'param') {
        expect(decl.name).toBe('文本')
        expect(decl.type).toBe('文本型')
      }
    })

    it('数组参数', () => {
      const decl = parseVarDeclFromLine('.参数 数据, 字节集,, 数组', 4)
      expect(decl?.kind).toBe('param')
      if (decl?.kind === 'param') {
        expect(decl.isArray).toBe(true)
      }
    })
  })

  describe('parseAssemblyVarDecl', () => {
    it('程序集变量', () => {
      const decl = parseVarDeclFromLine('.程序集变量 静态计数, 整数型, 公开', 1)
      expect(decl?.kind).toBe('assemblyVar')
      if (decl?.kind === 'assemblyVar') {
        expect(decl.name).toBe('静态计数')
        expect(decl.isPublic).toBe(true)
      }
    })
  })

  describe('未识别行', () => {
    it('非声明行返回 null', () => {
      expect(parseVarDeclFromLine('.如果真 (x > 0)', 1)).toBeNull()
      expect(parseVarDeclFromLine('返回 ()', 2)).toBeNull()
    })
  })
})
