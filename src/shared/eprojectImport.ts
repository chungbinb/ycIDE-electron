export type EProjectImportConflictAction = 'reuse' | 'overwrite'

export type OpenProjectSelectionResult =
  | { status: 'canceled' }
  | { status: 'epp'; eppPath: string }
  | { status: 'eFile'; eFilePath: string; projectName: string; targetDir: string; targetExists: boolean }

export type EProjectImportRequest = {
  eFilePath: string
  password?: string
  conflictAction?: EProjectImportConflictAction
}

export type EProjectImportErrorCode =
  | 'passwordRequired'
  | 'passwordInvalid'
  | 'unsupportedEncryptedType'
  | 'invalidProjectFile'
  | 'targetConflict'
  | 'conversionFailed'

export type EProjectImportResult =
  | { status: 'success'; projectDir: string; eppPath: string; warnings: string[] }
  | { status: 'passwordRequired'; passwordHint?: string }
  | { status: 'passwordInvalid'; passwordHint?: string }
  | { status: 'targetConflict'; eFilePath: string; projectName: string; targetDir: string }
  | { status: 'error'; code: Exclude<EProjectImportErrorCode, 'passwordRequired' | 'passwordInvalid' | 'targetConflict'>; message: string }
