"""Outgoing account email (password reset, address verification) over plain SMTP."""

from __future__ import annotations

import asyncio
import re
import smtplib
import ssl
from email.message import EmailMessage

import structlog

from app.core.config import settings

logger = structlog.get_logger()

DEV_ENVIRONMENTS = ("development", "dev", "local", "test")


def smtp_configured() -> bool:
    return bool(settings.SMTP_HOST and settings.SMTP_FROM)


def _send_sync(to: str, subject: str, body: str) -> None:
    message = EmailMessage()
    message["From"] = settings.SMTP_FROM
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)
    context = ssl.create_default_context()
    if settings.SMTP_PORT == 465:
        server = smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, timeout=20, context=context)
    else:
        server = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=20)
    with server:
        if settings.SMTP_PORT != 465 and settings.SMTP_STARTTLS:
            server.starttls(context=context)
        if settings.SMTP_USERNAME:
            server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
        server.send_message(message)


async def send_email(to: str, subject: str, body: str) -> bool:
    """Send one message. Never raises: account flows must not fail on mail trouble."""
    if not smtp_configured():
        if settings.ENVIRONMENT in DEV_ENVIRONMENTS:
            # Local development has no mail server: show the message (and its link) in the log.
            link = re.search(r"https?://\S+", body)
            logger.info("email_dev_outbox", to=to, link=link.group(0) if link else None, subject=subject, body=body)
        else:
            logger.error("email_not_sent_smtp_not_configured", subject=subject)
        return False
    try:
        await asyncio.to_thread(_send_sync, to, subject, body)
        logger.info("email_sent", subject=subject)
        return True
    except Exception as error:
        logger.error("email_send_failed", subject=subject, error=str(error))
        return False


def reset_email(link: str, minutes: int) -> tuple[str, str]:
    return (
        "NKMZ Chat — нууц үг сэргээх / Reset your password",
        "Сайн байна уу,\n\n"
        "NKMZ Chat-ийн нууц үгээ шинэчлэхийн тулд доорх холбоосыг нээнэ үү. "
        f"Холбоос {minutes} минут хүчинтэй бөгөөд нэг удаа ашиглагдана.\n\n"
        f"{link}\n\n"
        "Хэрэв та энэ хүсэлтийг илгээгээгүй бол энэ и-мэйлийг үл тоомсорлоно уу. Таны нууц үг өөрчлөгдөхгүй.\n\n"
        "—\n"
        f"Open the link above to choose a new NKMZ Chat password. It works once and expires in {minutes} minutes. "
        "If you did not ask for this, ignore this email; your password stays the same.\n",
    )


def verify_email(link: str, hours: int) -> tuple[str, str]:
    return (
        "NKMZ Chat — и-мэйлээ баталгаажуулна уу / Confirm your email",
        "Сайн байна уу,\n\n"
        "NKMZ Chat-д бүртгүүлсэнд баярлалаа. И-мэйл хаягаа баталгаажуулахын тулд доорх холбоосыг нээнэ үү. "
        f"Холбоос {hours} цаг хүчинтэй.\n\n"
        f"{link}\n\n"
        "Хэрэв та бүртгүүлээгүй бол энэ и-мэйлийг үл тоомсорлоно уу.\n\n"
        "—\n"
        f"Open the link above to confirm your email address for NKMZ Chat. It expires in {hours} hours. "
        "If you did not sign up, ignore this email.\n",
    )
