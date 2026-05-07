from email.message import EmailMessage
import smtplib

from app.core.config import settings


def smtp_enabled() -> bool:
    return bool(settings.smtp_host and settings.smtp_from_email)


def send_email(*, to_email: str, subject: str, text_body: str) -> bool:
    if not smtp_enabled():
        return False

    message = EmailMessage()
    message["To"] = to_email
    message["From"] = (
        f"{settings.smtp_from_name} <{settings.smtp_from_email}>"
        if settings.smtp_from_name
        else settings.smtp_from_email
    )
    message["Subject"] = subject
    message.set_content(text_body)

    if settings.smtp_use_ssl:
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=10) as server:
            if settings.smtp_username:
                server.login(settings.smtp_username, settings.smtp_password or "")
            server.send_message(message)
        return True

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as server:
        if settings.smtp_use_starttls:
            server.starttls()
        if settings.smtp_username:
            server.login(settings.smtp_username, settings.smtp_password or "")
        server.send_message(message)
    return True
