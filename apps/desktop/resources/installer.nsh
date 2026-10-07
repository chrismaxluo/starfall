; 安装、卸载界面的文字（electron-builder 自动加载 resources/installer.nsh）
; 界面上的大部分文字用安装包程序（NSIS）自带的简体中文：electron-builder.yml 里 toolsets.nsis 选了新版，
; 默认的旧版是 2010 年的译本（「解除安装」「检阅」「你的计算机」）。
; 这里只改 electron-builder 自己加的几句（原文用英文标点、软件名是英文 Starfall），软件名统一叫「星临」。
; customHeader 在加载语言之后插入，所以能覆盖；覆盖已有文字时 NSIS 会给出警告（打包时警告算失败），这几行里关掉

!macro customHeader
  !pragma warning push
  !pragma warning disable 6029 6030
  Name "星临"
  BrandingText "星临 ${VERSION}"
  LangString appRunning 2052 "星临正在运行。$\r$\n点击「确定」关闭它后继续；如果关不掉，请右键托盘图标选「退出星临」。"
  LangString appCannotBeClosed 2052 "星临没能关闭。$\r$\n请右键托盘图标选「退出星临」，然后点击「重试」。"
  LangString appClosing 2052 "正在关闭星临…"
  LangString installing 2052 "正在安装，请稍候…"
  LangString areYouSureToUninstall 2052 "确定要卸载星临吗？直播素材、规则和设置会保留，重新安装后还在。"
  LangString decompressionFailed 2052 "解压文件失败，请重新运行安装程序。"
  LangString uninstallFailed 2052 "删除旧版本的文件失败，请重新运行安装程序。"
  LangString loginWithAdminAccount 2052 "需要用管理员账户登录才能继续。"
  !pragma warning pop
!macroend
