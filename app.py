import os
import uuid
from datetime import datetime, timedelta

from flask import Flask, render_template, request, jsonify, redirect, url_for, flash
from flask_sqlalchemy import SQLAlchemy
from flask_login import (
    LoginManager, UserMixin, login_user, login_required,
    logout_user, current_user
)
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from dotenv import load_dotenv
from PIL import Image

load_dotenv()

# ---------------------------------------------------------------------------
# App / config
# ---------------------------------------------------------------------------
app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv("SECRET_KEY", "dev-key-change-me")

database_url = os.getenv("DATABASE_URL", "sqlite:///zkb_ai.db")
if database_url and database_url.startswith("postgres://"):
    database_url = database_url.replace("postgres://", "postgresql://", 1)
app.config['SQLALCHEMY_DATABASE_URI'] = database_url
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['MAX_CONTENT_LENGTH'] = 15 * 1024 * 1024  # 15 MB upload cap

UPLOAD_FOLDER = os.path.join('static', 'uploads')
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'zip', 'txt', 'docx', 'xlsx'}
IMAGE_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}

db = SQLAlchemy(app)
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'

# The Gemini client is optional at import time so the app still boots
# (and shows a clear error in chat) if the API key isn't configured yet.
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
gemini_client = None
gemini_error = None
try:
    if GEMINI_API_KEY:
        from google import genai
        gemini_client = genai.Client(api_key=GEMINI_API_KEY)
    else:
        gemini_error = "GEMINI_API_KEY is not set."
except Exception as exc:  # pragma: no cover - defensive
    gemini_error = f"Could not start the AI client: {exc}"


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(150), unique=True, nullable=False)
    password = db.Column(db.String(200), nullable=False)
    is_admin = db.Column(db.Boolean, default=False, nullable=False)
    messages = db.relationship('ChatMessage', backref='user', lazy=True,
                                cascade='all, delete-orphan')


class ChatMessage(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    sender = db.Column(db.String(50), nullable=False)  # 'user' or 'ai'
    text = db.Column(db.Text, nullable=True)
    file_path = db.Column(db.String(300), nullable=True)
    file_name = db.Column(db.String(300), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))


with app.app_context():
    db.create_all()
    # First account created (or the seeded admin below) gets admin rights.
    if not User.query.filter_by(username="zkbdeveloper1").first() and User.query.count() == 0:
        pass  # no auto-seed; first real signup can be promoted manually if needed


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def save_upload(file_storage):
    """Saves an uploaded file safely and returns (url, display_name) or (None, None)."""
    if not file_storage or file_storage.filename == '':
        return None, None
    if not allowed_file(file_storage.filename):
        raise ValueError("That file type isn't supported.")

    original_name = secure_filename(file_storage.filename)
    ext = original_name.rsplit('.', 1)[1].lower()
    unique_name = f"{uuid.uuid4().hex}.{ext}"
    save_path = os.path.join(app.config['UPLOAD_FOLDER'], unique_name)
    file_storage.save(save_path)

    if ext in IMAGE_EXTENSIONS:
        try:
            img = Image.open(save_path)
            img.thumbnail((1000, 1000))
            img.save(save_path)
        except Exception:
            pass  # not a valid image after all; keep the raw file

    return f"/{save_path.replace(os.sep, '/')}", original_name


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    return redirect(url_for('chat'))


@app.route("/signup", methods=["GET", "POST"])
def signup():
    if current_user.is_authenticated:
        return redirect(url_for('chat'))

    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""

        if len(username) < 3:
            flash("Username must be at least 3 characters.", "error")
            return redirect(url_for('signup'))
        if len(password) < 6:
            flash("Password must be at least 6 characters.", "error")
            return redirect(url_for('signup'))
        if User.query.filter_by(username=username).first():
            flash("That username is already taken.", "error")
            return redirect(url_for('signup'))
        if User.query.count() >= 5:
            flash("All 5 account slots are in use.", "error")
            return redirect(url_for('login'))

        hashed_password = generate_password_hash(password, method='scrypt')
        new_user = User(
            username=username,
            password=hashed_password,
            is_admin=(User.query.count() == 0),  # first account is admin
        )
        db.session.add(new_user)
        db.session.commit()
        login_user(new_user)
        return redirect(url_for('chat'))

    return render_template("signup.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('chat'))

    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""
        user = User.query.filter_by(username=username).first()

        if user and check_password_hash(user.password, password):
            login_user(user)
            return redirect(url_for('chat'))
        flash("Incorrect username or password.", "error")

    return render_template("login.html")


@app.route("/logout")
@login_required
def logout():
    logout_user()
    return redirect(url_for('chat'))


# ---------------------------------------------------------------------------
# Chat routes
# ---------------------------------------------------------------------------
@app.route("/chat")
def chat():
    history = []
    if current_user.is_authenticated:
        history = (ChatMessage.query
                   .filter_by(user_id=current_user.id)
                   .order_by(ChatMessage.id.asc())
                   .all())
    return render_template("chat.html", history=history)


@app.route("/send_message", methods=["POST"])
def send_message():
    user_text = (request.form.get("message") or "").strip()
    file = request.files.get("file")

    try:
        file_url, file_name = save_upload(file)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    if not user_text and not file_url:
        return jsonify({"error": "Message can't be empty."}), 400

    if current_user.is_authenticated:
        db.session.add(ChatMessage(
            user_id=current_user.id, sender='user',
            text=user_text, file_path=file_url, file_name=file_name,
        ))
        db.session.commit()

    if gemini_client is None:
        ai_reply = (
            "The AI backend isn't configured yet — set GEMINI_API_KEY in your "
            "environment to enable replies."
            if gemini_error else
            "The AI backend is unavailable right now."
        )
    else:
        prompt = user_text
        if file_url:
            prompt += f"\n[The user also attached a file: {file_name}]"
        try:
            response = gemini_client.models.generate_content(
                model='gemini-2.5-flash',
                contents=prompt,
            )
            ai_reply = response.text
        except Exception as exc:
            ai_reply = f"Sorry, I ran into an error generating a reply: {exc}"

    if current_user.is_authenticated:
        db.session.add(ChatMessage(user_id=current_user.id, sender='ai', text=ai_reply))
        db.session.commit()

    return jsonify({
        "reply": ai_reply,
        "file_url": file_url,
        "file_name": file_name,
        "timestamp": datetime.utcnow().strftime("%H:%M"),
    })


@app.route("/clear_history", methods=["POST"])
@login_required
def clear_history():
    ChatMessage.query.filter_by(user_id=current_user.id).delete()
    db.session.commit()
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(debug=True)
