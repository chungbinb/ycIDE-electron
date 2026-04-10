# Phase 15 Unsaved Draft Close Matrix

Evidence source: `tests/ui/theme-editing-workflow.spec.js`  
Case: `FLOW-01 + D15-01..D15-04 + D15-13/D15-15/D15-16: unsaved draft close parity and app exit`

## Captured Intents

UI test captures runtime intent sequence from shared close handler:

```txt
['close-button', 'escape', 'overlay', 'app-exit']
```

## Matrix

| Trigger | Intent value | Result in test | Parity verdict |
| --- | --- | --- | --- |
| Dialog close button (×) | `close-button` | Dialog remains open when decision=`continue` | ✅ |
| `Esc` key | `escape` | Dialog remains open when decision=`continue` | ✅ |
| Overlay click | `overlay` | Dialog remains open when decision=`continue` | ✅ |
| App window close (`window.close`) | `app-exit` | App stays open when decision=`continue` | ✅ |

## Default Safety Option Evidence (D15-14)

Contract test `D15-14 contract: unsaved-draft dialog keeps continue-editing as default/cancel action` verifies main-process dialog config:

- buttons: `['保存为自定义主题', '放弃改动', '继续编辑']`
- `defaultId: 2`
- `cancelId: 2`

## Conclusion

No close-path bypass observed. Settings close intents and app-exit share one unsaved-draft decision flow.
