// ZKB AI — chat client
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('chat-form');
  const textarea = document.getElementById('user-input');
  const fileInput = document.getElementById('file-input');
  const fileIndicator = document.getElementById('file-indicator');
  const chatBox = document.getElementById('chat-box');
  const thread = document.getElementById('thread');
  const sendBtn = document.getElementById('send-btn');
  const clearBtn = document.getElementById('clear-history-btn');
  const menuBtn = document.getElementById('mobile-menu-btn');
  const sidebar = document.getElementById('sidebar');

  // ---- Sidebar resize (desktop) ----
  const resizer = document.getElementById('resizer');
  if (resizer) {
    let isResizing = false;
    resizer.addEventListener('mousedown', () => {
      isResizing = true;
      document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const newWidth = e.clientX;
      if (newWidth > 200 && newWidth < 420) sidebar.style.width = newWidth + 'px';
    });
    document.addEventListener('mouseup', () => {
      isResizing = false;
      document.body.style.userSelect = '';
    });
  }

  // ---- Mobile sidebar toggle ----
  if (menuBtn) {
    menuBtn.addEventListener('click', () => sidebar.classList.toggle('open'));
  }

  // ---- Auto-resize textarea ----
  function resizeTextarea() {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 160) + 'px';
  }
  if (textarea) {
    textarea.addEventListener('input', resizeTextarea);
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form.requestSubmit();
      }
    });
  }

  // ---- File selection ----
  let selectedFile = null;
  if (fileInput) {
    fileInput.addEventListener('change', () => {
      selectedFile = fileInput.files[0] || null;
      updateFileIndicator();
    });
  }

  function updateFileIndicator() {
    if (selectedFile) {
      fileIndicator.innerHTML = `📎 ${escapeHtml(selectedFile.name)} <button type="button" id="remove-file">Remove</button>`;
      fileIndicator.classList.add('visible');
      document.getElementById('remove-file').addEventListener('click', () => {
        selectedFile = null;
        fileInput.value = '';
        fileIndicator.classList.remove('visible');
        fileIndicator.innerHTML = '';
      });
    } else {
      fileIndicator.classList.remove('visible');
      fileIndicator.innerHTML = '';
    }
  }

  // ---- Drag & drop ----
  const inputArea = document.querySelector('.chat-input-area');
  if (inputArea) {
    ['dragover', 'dragenter'].forEach(evt =>
      inputArea.addEventListener(evt, (e) => { e.preventDefault(); inputArea.style.borderColor = 'var(--accent)'; })
    );
    ['dragleave', 'drop'].forEach(evt =>
      inputArea.addEventListener(evt, (e) => { e.preventDefault(); inputArea.style.borderColor = ''; })
    );
    inputArea.addEventListener('drop', (e) => {
      const f = e.dataTransfer.files[0];
      if (f) {
        selectedFile = f;
        updateFileIndicator();
      }
    });
  }

  // ---- Toasts ----
  function showToast(message, type = 'error') {
    let stack = document.querySelector('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      document.body.appendChild(stack);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    stack.appendChild(toast);
    setTimeout(() => toast.remove(), 4500);
  }

  // ---- Rendering helpers ----
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function renderMarkdown(text) {
    if (window.marked && window.DOMPurify) {
      const raw = window.marked.parse(text, { breaks: true });
      return window.DOMPurify.sanitize(raw);
    }
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  function currentTime() {
    return new Date().toTimeString().slice(0, 5);
  }

  function appendMessage({ sender, text, fileUrl, fileName, time, pending }) {
    const wrap = document.createElement('div');
    wrap.className = `message ${sender}`;
    if (pending) wrap.dataset.pending = 'true';

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = sender === 'ai' ? 'Z' : 'Y';

    const body = document.createElement('div');
    body.className = 'message-body';

    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.innerHTML = `<span class="message-sender">${sender === 'ai' ? 'ZKB AI' : 'You'}</span><span class="message-time">${time || currentTime()}</span>`;

    const textEl = document.createElement('div');
    textEl.className = 'message-text';

    if (pending) {
      textEl.innerHTML = '<span class="typing-dots"><span></span><span></span><span></span></span>';
    } else {
      textEl.innerHTML = sender === 'ai' ? renderMarkdown(text || '') : escapeHtml(text || '');
    }

    body.appendChild(meta);
    body.appendChild(textEl);

    if (fileUrl) {
      const isImage = /\.(png|jpe?g|gif|webp)$/i.test(fileUrl);
      if (isImage) {
        const preview = document.createElement('a');
        preview.href = fileUrl;
        preview.target = '_blank';
        preview.className = 'attachment-preview';
        preview.innerHTML = `<img src="${fileUrl}" alt="${escapeHtml(fileName || 'attachment')}">`;
        body.appendChild(preview);
      } else {
        const link = document.createElement('a');
        link.href = fileUrl;
        link.target = '_blank';
        link.className = 'attachment-file';
        link.innerHTML = `📄 ${escapeHtml(fileName || 'Download file')}`;
        body.appendChild(link);
      }
    }

    wrap.appendChild(avatar);
    wrap.appendChild(body);
    thread.appendChild(wrap);
    chatBox.scrollTop = chatBox.scrollHeight;
    return wrap;
  }

  // ---- Submit ----
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const textVal = textarea.value.trim();
      if (!textVal && !selectedFile) return;

      appendMessage({ sender: 'user', text: textVal });

      const formData = new FormData();
      formData.append('message', textVal);
      if (selectedFile) formData.append('file', selectedFile);

      textarea.value = '';
      resizeTextarea();
      const fileWasAttached = !!selectedFile;
      selectedFile = null;
      fileInput.value = '';
      updateFileIndicator();
      sendBtn.disabled = true;

      const pendingMsg = appendMessage({ sender: 'ai', pending: true });

      try {
        const res = await fetch('/send_message', { method: 'POST', body: formData });
        const data = await res.json();

        if (!res.ok) {
          pendingMsg.remove();
          showToast(data.error || 'Something went wrong sending that message.');
          sendBtn.disabled = false;
          return;
        }

        pendingMsg.remove();
        appendMessage({
          sender: 'ai',
          text: data.reply,
          fileUrl: fileWasAttached ? null : null, // AI replies don't carry the user's file
          time: data.timestamp,
        });

        // Show the uploaded file under the user's own message, once the server confirms it.
        if (data.file_url) {
          const lastUserMsg = thread.querySelectorAll('.message.user');
          const target = lastUserMsg[lastUserMsg.length - 1];
          if (target) {
            const isImage = /\.(png|jpe?g|gif|webp)$/i.test(data.file_url);
            const body = target.querySelector('.message-body');
            const el = document.createElement(isImage ? 'a' : 'a');
            el.href = data.file_url;
            el.target = '_blank';
            if (isImage) {
              el.className = 'attachment-preview';
              el.innerHTML = `<img src="${data.file_url}" alt="${escapeHtml(data.file_name || 'attachment')}">`;
            } else {
              el.className = 'attachment-file';
              el.innerHTML = `📄 ${escapeHtml(data.file_name || 'Download file')}`;
            }
            body.appendChild(el);
          }
        }
      } catch (err) {
        pendingMsg.remove();
        showToast('Connection error — check your network and try again.');
      } finally {
        sendBtn.disabled = false;
      }
    });
  }

  // ---- Clear history ----
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      if (!confirm('Clear your entire chat history? This can\'t be undone.')) return;
      try {
        const res = await fetch('/clear_history', { method: 'POST' });
        if (res.ok) {
          thread.innerHTML = '';
          showToast('Chat history cleared.', 'success');
        } else {
          showToast('Could not clear history.');
        }
      } catch (err) {
        showToast('Connection error.');
      }
    });
  }

  // Autofocus input on desktop
  if (textarea && window.innerWidth > 760) textarea.focus();
});
