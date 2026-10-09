; 安装、卸载界面的文字和卸载时的询问（electron-builder 自动加载 resources/installer.nsh）
; 界面上的大部分文字用安装包程序（NSIS）自带的简体中文：electron-builder.yml 里 toolsets.nsis 选了新版，
; 默认的旧版是 2010 年的译本（「解除安装」「检阅」「你的计算机」）。
; 这里只改 electron-builder 自己加的几句提示（原文用英文标点，有的没有中文）。
; customHeader 在加载语言之后插入，所以能覆盖；覆盖已有文字时 NSIS 会给出警告（打包时警告算失败），这几行里关掉

!macro customHeader
  !pragma warning push
  !pragma warning disable 6030
  LangString appRunning 2052 "星临正在运行。$\r$\n点击「确定」关闭它后继续；如果关不掉，请右键托盘图标选「退出星临」。"
  LangString appCannotBeClosed 2052 "星临没能关闭。$\r$\n请右键托盘图标选「退出星临」，然后点击「重试」。"
  LangString appClosing 2052 "正在关闭星临…"
  LangString installing 2052 "正在安装，请稍候…"
  LangString areYouSureToUninstall 2052 "确定要卸载星临吗？"
  LangString decompressionFailed 2052 "解压文件失败，请重新运行安装程序。"
  LangString uninstallFailed 2052 "删除旧版本的文件失败，请重新运行安装程序。"
  LangString loginWithAdminAccount 2052 "需要用管理员账户登录才能继续。"
  !pragma warning pop
!macroend

; 卸载时问要不要连数据一起删（素材、规则、设置、登录信息，在 %APPDATA%\Starfall，见 main.ts），默认不删。
; 升级和覆盖安装时旧版本也会被「卸载」一次（带 --updated），这时不问、不删；静默卸载（/S）也不删
!macro customUnInstall
  ${ifNot} ${isUpdated}
  ${andIfNot} ${Silent}
    ${if} ${Cmd} `MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "是否同时删除星临的数据？$\r$\n$\r$\n包括素材、规则、设置和 B站登录信息。$\r$\n选「否」会保留，重新安装后可以接着用；$\r$\n选「是」会彻底删除，不能恢复。" IDYES`
      ; 数据在当前用户的 AppData 里（按「所有用户」安装时 $APPDATA 默认指向公共目录，先切过来）
      SetShellVarContext current
      RMDir /r "$APPDATA\Starfall"
      ${if} $installMode == "all"
        SetShellVarContext all
      ${endif}
    ${endif}
  ${endif}
!macroend
