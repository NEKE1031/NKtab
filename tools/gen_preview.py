"""把真 newtab.html 包一层，生成一个可以双击打开看的本地预览页（预览.html）。

预览页不是扩展的一部分（.gitignore 里排掉了）：
用真 newtab.css / 真 newtab.js，只是没有壁纸、读不到真实数据。
"""
import pathlib
import re

src = pathlib.Path("newtab.html").read_text(encoding="utf-8")

note = '''  <style>
    .preview-note { position: fixed; left: 16px; top: 16px; z-index: 999; max-width: 470px;
      padding: 12px 14px; font: 13px/1.6 "Microsoft YaHei UI","Microsoft YaHei",sans-serif;
      color: #fff; background: rgba(10,14,22,.85); border: 1px solid rgba(255,255,255,.22);
      border-radius: 12px; backdrop-filter: blur(12px); }
    .preview-note b { color: #ffd479; }
    .preview-note button { margin-top: 8px; padding: 5px 10px; font: inherit; font-size: 12px;
      color: #fff; background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.28);
      border-radius: 999px; cursor: pointer; }
  </style>
'''

src = src.replace("</head>", note + "</head>")
src = src.replace("<title>新标签页</title>", "<title>NKtab 预览（不是扩展的一部分）</title>")
src = re.sub(r"<!-- NKtab 新标签页[^\n]*\n[^\n]*\n", "", src)

tail = '''
<script>
  const note = document.createElement("div");
  note.className = "preview-note";
  note.innerHTML = '<b>本地预览页</b>：跟你真的新标签页一样（色块宫格、右边那栏卡片轮播、' +
    '搜索框左边的小引擎图标 + 放大镜）。差别：没有壁纸（灰底代替）、' +
    '读不到你真实的数据。';
  const close = document.createElement("button");
  close.textContent = "知道了";
  close.onclick = () => note.remove();
  note.append(document.createElement("br"), close);
  document.body.append(note);
</script>
</body>
</html>
'''

src = re.sub(r"</body>\s*</html>\s*$", tail, src)
pathlib.Path("预览.html").write_text(src, encoding="utf-8")
print("写好 预览.html（%d 字符）" % len(src))
