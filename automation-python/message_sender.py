# flake8: noqa

import pyautogui
import time
import os
import Quartz
# PIL은 ImageDraw에 필요하지만 리팩토링 후 명시적으로 사용되지 않음. 다른 곳에서 필요하면 유지.
# from PIL import ImageDraw
import datetime
import pathlib
import cv2
import numpy as np # numpy import 추가
import shutil
import pyperclip
import pytesseract
import subprocess
import logging

# --- 상수 정의 ---
BASE_DIR = pathlib.Path(__file__).parent.absolute()
DEBUG_DIR = BASE_DIR / "debugs-screens" # 디버그 스크린샷 저장 경로

# 시간 상수 (시스템 성능에 따라 조정)
SHORT_SLEEP = 0.3 # 짧은 대기 시간
MEDIUM_SLEEP = 0.6 # 중간 대기 시간
LONG_SLEEP = 1.2 # 긴 대기 시간
EXTRA_LONG_SLEEP = 2.0 # 매우 긴 대기 시간

# UI 상호작용 상수
SEARCH_USER_SHORTCUT = '1' # 사용자 검색 단축키 (Cmd+1, 친구 탭으로 가정) - 실제 동작 확인 필요
PASTE_SHORTCUT = 'v' # 붙여넣기 단축키 (Cmd+V)
SELECT_ALL_SHORTCUT = 'a' # 전체 선택 단축키 (Cmd+A, 필드 지우기에 유용할 수 있음)

# OCR 패턴
OCR_ERROR_PATTERNS = [ # OCR 에러 감지 문자열 목록
    "전송 실패", "메시지를 보낼 수 없습니다",
    "차단", "수신 거부", "오류가 발생",
    "메시지 전송에 실패"
]
OCR_SUCCESS_PATTERNS = ["읽음", "1", "전송됨"] # OCR 성공 감지 문자열 목록 (신뢰도 낮을 수 있음)

# --- 로깅 설정 ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
log = logging.getLogger(__name__)

# --- 함수 정의 ---

# KakaoTalk 앱을 활성화합니다.
def focus_kakaotalk():
    """KakaoTalk 애플리케이션을 활성화합니다."""
    try:
        script = 'tell application "KakaoTalk" to activate'
        subprocess.run(['osascript', '-e', script], check=True, capture_output=True)
        time.sleep(SHORT_SLEEP) # 활성화 시간 확보
        log.info("KakaoTalk 앱 활성화 완료.")
        return True
    except subprocess.CalledProcessError as e:
        log.error(f"KakaoTalk 활성화 실패: {e.stderr.decode()}")
        return False
    except Exception as e:
        log.error(f"KakaoTalk 활성화 중 예상치 못한 오류 발생: {e}")
        return False

# 디버그 디렉토리를 비우고 다시 생성합니다.
def clear_debug_dir():
    """디버그 디렉토리를 비우고 다시 생성합니다."""
    try:
        if DEBUG_DIR.exists():
            shutil.rmtree(DEBUG_DIR)
        DEBUG_DIR.mkdir(parents=True, exist_ok=True)
        log.info(f"디버그 디렉토리 초기화 완료: {DEBUG_DIR}")
    except Exception as e:
        log.error(f"디버그 디렉토리 초기화 실패: {e}")

# Quartz를 사용하여 KakaoTalk 메인 창 영역을 가져옵니다.
# 잠재적 창들에 대한 상세 정보를 로그로 남기고, 필요시 화면 전체 크기로 대체합니다.
def get_kakaotalk_window_region():
    """
    Quartz를 사용하여 KakaoTalk 메인 창 영역을 가져옵니다.
    잠재적 창들에 대한 상세 정보를 로그로 남기고, 필요시 화면 전체 크기로 대체합니다.
    (x, y, 너비, 높이) 튜플 또는 Quartz 완전 실패 시 None을 반환합니다.
    """
    try:
        # 화면에 보이는 창 목록만 가져오기 (데스크탑 요소 제외)
        window_list = Quartz.CGWindowListCopyWindowInfo(
            Quartz.kCGWindowListOptionOnScreenOnly | Quartz.kCGWindowListExcludeDesktopElements,
            Quartz.kCGNullWindowID
        )
        target_owner = "KakaoTalk" # 찾으려는 앱 소유자 이름
        found_kakao_windows = [] # 찾은 카카오톡 창 정보 저장 리스트

        for window in window_list:
            owner_name = window.get("kCGWindowOwnerName", "")
            if owner_name == target_owner:
                window_name = window.get("kCGWindowName", "")
                bounds = window.get("kCGWindowBounds", {})
                layer = window.get("kCGWindowLayer", -1)
                x = int(bounds.get("X", 0))
                y = int(bounds.get("Y", 0))
                w = int(bounds.get("Width", 0))
                h = int(bounds.get("Height", 0))
                log.debug(f"잠재적 KakaoTalk 창 발견: 이름='{window_name}', 레이어={layer}, 영역=({x}, {y}, {w}, {h})")
                found_kakao_windows.append({'name': window_name, 'layer': layer, 'x': x, 'y': y, 'w': w, 'h': h})

                # 주요 확인: Layer 0 이고 충분한 크기
                if layer == 0 and w > 200 and h > 300:
                    log.info(f"KakaoTalk 창 선택 (Layer 0): 이름='{window_name}', 영역=({x}, {y}, {w}, {h})")
                    return (x, y, w, h)

        # 대체 확인 1: Layer 0 확인 실패 시, 충분한 크기의 다른 레이어 창 확인
        log.debug("Layer 0 창을 찾지 못했거나 너무 작습니다. 다른 레이어 확인 중...")
        for win_info in found_kakao_windows:
            if win_info['w'] > 200 and win_info['h'] > 300:
                 log.warning(f"대체 KakaoTalk 창 사용 (Layer {win_info['layer']}): 이름='{win_info['name']}', 영역=({win_info['x']}, {win_info['y']}, {win_info['w']}, {win_info['h']})")
                 return (win_info['x'], win_info['y'], win_info['w'], win_info['h'])

        # 대체 확인 2: 적절한 창을 찾지 못한 경우 전체 화면 크기 사용
        log.warning("Quartz를 통해 적절한 KakaoTalk 창을 찾지 못했습니다. 전체 화면 영역으로 대체합니다.")
        screen_width, screen_height = pyautogui.size()
        return (0, 0, screen_width, screen_height)

    except Exception as e:
        log.error(f"KakaoTalk 창 영역 가져오기 오류: {e}", exc_info=True)
        # Quartz 오류 발생 시 최후의 수단으로 대체
        log.warning("Quartz 실패. 최후의 수단으로 전체 화면 영역으로 대체합니다.")
        try:
            screen_width, screen_height = pyautogui.size()
            return (0, 0, screen_width, screen_height)
        except Exception as screen_e:
             log.critical(f"화면 크기 가져오기조차 실패: {screen_e}")
             return None # 완전 실패

# 텍스트 메시지를 보내는 내부 헬퍼 함수입니다.
def _send_text(content: str):
    """텍스트 메시지를 보내는 내부 헬퍼 함수입니다."""
    try:
        log.info(f"텍스트 전송 시도: {content[:30]}...")
        # 영역 가져오기 전 활성화 확인
        if not focus_kakaotalk():
             log.error("텍스트 전송 불가, KakaoTalk 활성화 실패.")
             return False
        time.sleep(SHORT_SLEEP) # 활성화 후 짧은 지연

        chat_region = get_kakaotalk_window_region()
        if not chat_region:
            # get_kakaotalk_window_region의 대체 로직으로 인해 이 경우는 드물어짐
            log.critical("텍스트 전송 불가, 창 영역 가져오기 실패 (대체 포함).")
            return False
        elif chat_region[0] == 0 and chat_region[1] == 0 and chat_region[2] == pyautogui.size()[0]:
             # 전체 화면 대체 사용 시 경고 및 클릭 위치 조정
             log.warning("전체 화면 영역 대체를 사용하여 텍스트 전송 중. 클릭 위치가 부정확할 수 있습니다.")
             # 전체 화면에 대한 클릭 위치 조정 - 예: 하단 중앙?
             input_x = chat_region[2] // 2
             input_y = chat_region[3] - 50 # 전체 화면의 경우 하단 가장자리에서 더 위로
        else:
            # 찾은 채팅 창의 하단 중앙 근처 클릭
            input_x = chat_region[0] + chat_region[2] // 2
            input_y = chat_region[1] + chat_region[3] - 40 # 대략적인 입력 필드 Y 좌표

        pyautogui.click(input_x, input_y)
        time.sleep(SHORT_SLEEP)

        # 기존 내용 지우기 (선택 사항, 필드가 활성화되지 않으면 문제 발생 가능)
        # pyautogui.hotkey('command', SELECT_ALL_SHORTCUT)
        # time.sleep(SHORT_SLEEP)
        # pyautogui.press('delete')
        # time.sleep(SHORT_SLEEP)

        # 내용 복사 및 붙여넣기, 전송
        pyperclip.copy(content)
        time.sleep(SHORT_SLEEP) # 클립보드 업데이트 시간 확보
        pyautogui.hotkey('command', PASTE_SHORTCUT)
        time.sleep(MEDIUM_SLEEP) # 붙여넣기 대기
        pyautogui.press('enter')
        time.sleep(LONG_SLEEP) # 메시지 전송 대기
        log.info("텍스트 전송 성공.")
        return True
    except Exception as e:
        log.error(f"텍스트 전송 중 오류 발생: {e}", exc_info=True)
        return False

# 이미지 메시지를 보내는 내부 헬퍼 함수입니다.
def _send_image(abs_path: str, filename: str):
    """이미지 메시지를 보내는 내부 헬퍼 함수입니다."""
    if not os.path.exists(abs_path):
        log.error(f"이미지 파일 없음: {abs_path}")
        return False

    # 방법 1: AppleScript를 통한 직접 클립보드 복사 (보통 가장 신뢰성 높음)
    try:
        log.info(f"직접 복사를 통한 이미지 전송 시도: {filename}")
        script = f'set the clipboard to (read (POSIX file "{abs_path}") as TIFF picture)'
        subprocess.run(['osascript', '-e', script], check=True, capture_output=True, timeout=10)
        time.sleep(MEDIUM_SLEEP)

        # 영역 가져오기 전 활성화 확인
        if not focus_kakaotalk():
             log.error("이미지 전송 불가, KakaoTalk 활성화 실패.")
             return False
        time.sleep(SHORT_SLEEP)

        chat_region = get_kakaotalk_window_region()
        if not chat_region:
            log.critical("이미지 전송 불가, 창 영역 가져오기 실패 (대체 포함).")
            return False
        elif chat_region[0] == 0 and chat_region[1] == 0 and chat_region[2] == pyautogui.size()[0]:
             # 전체 화면 대체 사용 시 경고 및 클릭 위치 조정
             log.warning("전체 화면 영역 대체를 사용하여 이미지 전송 중. 클릭 위치가 부정확할 수 있습니다.")
             input_x = chat_region[2] // 2
             input_y = chat_region[3] - 50
        else:
            # 찾은 채팅 창의 하단 중앙 근처 클릭
            input_x = chat_region[0] + chat_region[2] // 2
            input_y = chat_region[1] + chat_region[3] - 40

        pyautogui.click(input_x, input_y)
        time.sleep(SHORT_SLEEP)

        # 붙여넣기 및 전송
        pyautogui.hotkey('command', PASTE_SHORTCUT)
        time.sleep(LONG_SLEEP) # 이미지 붙여넣기 미리보기 대기 시간 증가
        pyautogui.press('enter')
        time.sleep(EXTRA_LONG_SLEEP) # 이미지 업로드/전송 대기 시간 증가
        log.info(f"직접 복사/전송으로 이미지 전송 성공: {filename}")
        return True

    # ... _send_image 함수의 나머지 부분 (오류 처리 및 대체 방법 포함) ...
    except subprocess.TimeoutExpired:
        log.error("AppleScript를 통해 클립보드로 이미지 복사 중 시간 초과.")
    except subprocess.CalledProcessError as e:
        log.error(f"AppleScript를 통한 클립보드 이미지 복사 실패: {e.stderr.decode()}")
    except Exception as e:
        log.error(f"직접 복사를 통한 이미지 전송 중 오류 발생: {e}", exc_info=True)

    # 방법 2: Finder 사용 대체 (신뢰성 낮고 방해적임)
    try:
        log.warning(f"직접 이미지 복사 실패. Finder 대체 방법 시도: {filename}")
        # Finder 상호작용 전 KakaoTalk 활성화 확인
        if not focus_kakaotalk(): return False # KakaoTalk 활성화할 수 없으면 중단

        # 단순화된 Finder 상호작용 - 파일 경로 복사 후 '폴더로 이동' 사용
        pyperclip.copy(abs_path)
        time.sleep(SHORT_SLEEP)

        # Finder 활성화 및 '폴더로 이동' 열기
        subprocess.run(['osascript', '-e', 'tell application "Finder" to activate'], check=True)
        time.sleep(MEDIUM_SLEEP)
        pyautogui.hotkey('command', 'shift', 'g') # 폴더로 이동 단축키
        time.sleep(MEDIUM_SLEEP)

        # 경로 붙여넣고 이동
        pyautogui.hotkey('command', PASTE_SHORTCUT)
        time.sleep(SHORT_SLEEP)
        pyautogui.press('enter')
        time.sleep(LONG_SLEEP) # Finder 이동 대기

        # 파일 선택 (선택/표시된 유일한 파일이라고 가정)
        pyautogui.hotkey('command', 'c') # 파일 자체 복사
        time.sleep(MEDIUM_SLEEP)

        # KakaoTalk으로 다시 전환하고 붙여넣기
        if not focus_kakaotalk(): return False
        time.sleep(MEDIUM_SLEEP)

        # 입력 필드 다시 클릭 (활성화 확인 및 영역 가져오기)
        if not focus_kakaotalk(): return False
        time.sleep(MEDIUM_SLEEP)
        chat_region = get_kakaotalk_window_region() # 영역 다시 가져오기
        if not chat_region:
             log.error("이미지 전송 불가 (Finder 대체), 채팅 창 영역 가져오기 실패.")
             return False
        elif chat_region[0] == 0 and chat_region[1] == 0 and chat_region[2] == pyautogui.size()[0]:
             # 전체 화면 대체 사용 시 경고
             log.warning("Finder 대체를 사용하여 전체 화면 영역으로 이미지 전송 중. 클릭 부정확할 수 있음.")
             input_x = chat_region[2] // 2
             input_y = chat_region[3] - 50
        else:
            # 찾은 채팅 창의 하단 중앙 근처 클릭
            input_x = chat_region[0] + chat_region[2] // 2
            input_y = chat_region[1] + chat_region[3] - 40

        pyautogui.click(input_x, input_y)
        time.sleep(SHORT_SLEEP)

        # 붙여넣기 및 전송
        pyautogui.hotkey('command', PASTE_SHORTCUT)
        time.sleep(LONG_SLEEP)
        pyautogui.press('enter')
        time.sleep(EXTRA_LONG_SLEEP)
        log.info(f"Finder 대체 방식으로 이미지 전송 성공: {filename}")
        return True

    except Exception as e:
        log.error(f"이미지 전송 Finder 대체 방식 실패: {e}", exc_info=True)
        # 최종 대체: 경로를 텍스트로 전송
        log.warning("모든 이미지 전송 방법 실패. 경로를 텍스트로 전송합니다.")
        return _send_text(f"이미지 전송 실패. 경로: {abs_path}")

# screencapture를 사용하여 KakaoTalk 창 내용을 캡처합니다.
def capture_kakao_window(output_path):
    """screencapture를 사용하여 KakaoTalk 창 내용을 캡처합니다."""
    try:
        output_dir = os.path.dirname(output_path)
        os.makedirs(output_dir, exist_ok=True) # 출력 디렉토리 생성

        # 캡처 전 활성화 확인
        if not focus_kakaotalk():
            log.error("창 캡처 불가, KakaoTalk 활성화 실패.")
            return False

        # AppleScript를 사용하여 가장 앞의 KakaoTalk 창 ID 찾기
        script = '''
        tell application "System Events"
            tell process "KakaoTalk"
                set frontmost to true
                delay 0.2
                try
                    set win to first window whose role is "AXWindow" and subrole is "AXStandardWindow"
                    return id of win
                on error
                    return -1
                end try
            end tell
        end tell
        '''
        result = subprocess.run(['osascript', '-e', script], capture_output=True, text=True, check=True, timeout=5)
        window_id_str = result.stdout.strip()

        if window_id_str and window_id_str != "-1":
            try:
                window_id = int(window_id_str)
                # ID로 특정 창 캡처
                subprocess.run(['screencapture', '-x', '-l', str(window_id), output_path], check=True, timeout=10)
                log.info(f"ID({window_id})로 KakaoTalk 창 캡처 완료: {output_path}")
                # 파일 생성 및 크기 확인
                if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
                    return True
                else:
                    log.error(f"ID로 screencapture 실행했으나 출력 파일이 없거나 비어 있음: {output_path}")
                    # 활성 창 캡처로 대체 시도
            except ValueError:
                log.warning(f"창 ID 파싱 불가: {window_id_str}. 활성 창 캡처로 대체합니다.")
            except subprocess.TimeoutExpired:
                 log.error(f"창 ID {window_id} 캡처 시간 초과.")
            except subprocess.CalledProcessError as e:
                 log.error(f"창 ID {window_id} 캡처 오류: {e.stderr}")
        else:
            log.warning("AppleScript를 통해 KakaoTalk 창 ID를 가져올 수 없습니다. 활성 창 캡처로 대체합니다.")

        # 대체: 현재 활성 창 캡처 (KakaoTalk이어야 함)
        subprocess.run(['screencapture', '-x', '-W', output_path], check=True, timeout=10)
        log.info(f"활성 창 캡처 완료 (대체): {output_path}")
        # 파일 생성 및 크기 확인
        if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            return True
        else:
            log.error(f"활성 창 screencapture 실행했으나 출력 파일이 없거나 비어 있음: {output_path}")
            return False

    except subprocess.TimeoutExpired:
        log.error("screencapture 중 시간 초과 발생.")
        return False
    except subprocess.CalledProcessError as e:
        log.error(f"screencapture 명령어 실패: {e.stderr}")
        return False
    except Exception as e:
        log.error(f"KakaoTalk 창 캡처 실패: {e}", exc_info=True)
        return False

# OCR을 사용하여 마지막으로 보낸 메시지의 상태를 확인합니다.
def check_message_status(username, timestamp):
    """OCR을 사용하여 마지막으로 보낸 메시지의 상태를 확인합니다."""
    capture_filename = f"capture_{username}_{timestamp}.png"
    capture_path = DEBUG_DIR / capture_filename
    # 상태 확인을 위해 채팅 창 캡처
    if not capture_kakao_window(str(capture_path)):
        return False, "상태 확인을 위한 채팅 창 캡처 실패"

    log.debug(f"상태 확인용 창 캡처 완료: {capture_path}")

    try:
        img = cv2.imread(str(capture_path))
        if img is None:
            log.error(f"캡처된 이미지 로드 실패: {capture_path}")
            return False, "캡처된 이미지 로드 실패"

        # 최근 메시지/상태를 위해 하단 부분 자르기 (예: 마지막 15-20%)
        height, _ = img.shape[:2]
        crop_height = int(height * 0.20)
        bottom_img = img[height - crop_height:height, :]

        # 전처리: 그레이스케일
        gray_img = cv2.cvtColor(bottom_img, cv2.COLOR_BGR2GRAY)

        # 선택 사항: 임계값 처리 (튜닝 필요할 수 있음)
        # _, thresh_img = cv2.threshold(gray_img, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        # preprocessed_img = thresh_img
        preprocessed_img = gray_img # 현재는 그레이스케일 사용

        # 디버깅을 위해 전처리된 이미지 저장
        preprocessed_path = DEBUG_DIR / f"preprocessed_{capture_filename}"
        cv2.imwrite(str(preprocessed_path), preprocessed_img)
        log.debug(f"OCR용 전처리 이미지 저장됨: {preprocessed_path}")

        # OCR 수행
        # 페이지 분할 모드 지정 (예: 6은 균일한 텍스트 블록 하나로 가정)
        custom_config = r'--oem 3 --psm 6 -l kor+eng'
        ocr_text = pytesseract.image_to_string(preprocessed_img, config=custom_config)
        log.debug(f"OCR 결과 (하단 영역): '{ocr_text.strip()}'")

        # 오류 패턴 확인
        for pattern in OCR_ERROR_PATTERNS:
            if pattern in ocr_text:
                error_msg = f"잠재적 메시지 전송 오류 감지: OCR 텍스트에서 '{pattern}' 발견."
                log.error(error_msg)
                return False, error_msg

        # 선택 사항: 성공 패턴 확인 (신뢰성 낮음)
        # for pattern in OCR_SUCCESS_PATTERNS:
        #     if pattern in ocr_text:
        #         log.info(f"메시지 성공 패턴 감지: '{pattern}'")
        #         return True, ""

        # 오류 패턴이 없으면 일단 성공으로 간주
        log.info("OCR 텍스트에서 명시적인 오류 패턴을 찾지 못했습니다. 성공으로 간주합니다.")
        return True, ""

    except pytesseract.TesseractNotFoundError:
        log.error("Tesseract가 설치되지 않았거나 PATH에 없습니다.")
        return False, "Tesseract OCR 엔진을 찾을 수 없음"
    except Exception as e:
        log.error(f"메시지 상태 확인 중 오류 발생 (OCR): {e}", exc_info=True)
        return False, f"OCR 처리 오류: {e}"

# 지정된 사용자에게 KakaoTalk을 통해 메시지를 보냅니다.
def send_messages_via_kakao(message_groups):
    """지정된 사용자에게 KakaoTalk을 통해 메시지를 보냅니다."""
    clear_debug_dir() # 디버그 디렉토리 초기화
    results = [] # 결과 저장 리스트
    # 초기 KakaoTalk 활성화 확인
    if not focus_kakaotalk():
        log.error("초기 KakaoTalk 활성화 실패. 중단합니다.")
        # KakaoTalk을 초기에 활성화할 수 없으면 모든 그룹에 대해 실패 반환
        for group in message_groups:
             results.append({"username": group["username"], "status": "fail", "reason": "KakaoTalk 활성화 실패"})
        return results
    time.sleep(MEDIUM_SLEEP)

    for group in message_groups:
        username = group["username"]
        messages = group["messages"]
        group_status = "pending" # 그룹 상태: pending, success, fail, skip
        error_reason = None # 오류 사유
        first_message_success = False # 첫 메시지 전송 및 확인 성공 여부 추적

        log.info(f"--- 사용자 처리 시작: {username} ---")

        try:
            # 1. 채팅 탭으로 이동 및 사용자 검색
            # 채팅 탭 활성화 확인 (Cmd+2가 종종 작동하지만, 먼저 친구 탭 Cmd+1이 필요할 수 있음)
            pyautogui.hotkey('command', '2') # 채팅 탭 직접 활성화 시도
            time.sleep(MEDIUM_SLEEP)
            # 검색이 전역이 아니라면 Cmd+F 또는 검색 아이콘 클릭 필요할 수 있음
            pyautogui.hotkey('command', 'f') # 표준 검색 단축키
            time.sleep(MEDIUM_SLEEP)

            # 사용자 이름 복사 및 붙여넣기
            pyperclip.copy(username)
            time.sleep(SHORT_SLEEP)
            pyautogui.hotkey('command', PASTE_SHORTCUT)
            time.sleep(LONG_SLEEP) # 검색 결과 대기
            

            # 첫 번째 결과 선택 (올바른 사용자/채팅이라고 가정)
            # 이 부분은 불안정하며 안정성을 위해 이미지 인식 필요할 수 있음
            pyautogui.press('down', presses=1, interval=SHORT_SLEEP) # 결과로 아래로 이동
            time.sleep(SHORT_SLEEP)
            pyautogui.press('enter') # 선택
            time.sleep(LONG_SLEEP) # 채팅 창 열기/활성화 대기

            timestamp = datetime.datetime.now().strftime('%Y%m%d%H%M%S') # 타임스탬프 생성

            # 보낼 메시지가 없는 경우
            if not messages:
                log.warning(f"사용자 {username}에게 보낼 메시지가 없습니다. 건너뜁니다.")
                group_status = "skip"
                error_reason = "제공된 메시지 없음"
                # 채팅 창 닫기 (열렸다고 가정)
                pyautogui.hotkey('command', 'w') # 표준 창 닫기 단축키
                time.sleep(MEDIUM_SLEEP)
                continue # 다음 사용자로 건너뛰기

            # --- 메시지 전송 ---
            for idx, msg in enumerate(messages):
                msg_type = msg.get("type", "unknown") # 메시지 타입 가져오기
                content = msg.get("content", "") # 메시지 내용 가져오기
                send_success = False # 전송 성공 여부 플래그

                # 내용이 비어 있으면 건너뛰기
                if not content:
                    log.warning(f"{username}의 메시지 #{idx+1} ({msg_type}) 내용이 비어 있습니다. 메시지를 건너뜁니다.")
                    continue

                log.info(f"{username}에게 메시지 #{idx+1} ({msg_type}) 전송 중...")

                # 메시지 타입에 따라 전송 함수 호출
                if msg_type == "text":
                    send_success = _send_text(content)
                elif msg_type == "image":
                    abs_path = os.path.abspath(content) # 절대 경로 확인
                    filename = os.path.basename(abs_path) # 파일 이름 추출
                    send_success = _send_image(abs_path, filename)
                else:
                    # 지원되지 않는 타입이면 경고 로그 남기고 건너뛰기
                    log.warning(f"메시지 #{idx+1}의 지원되지 않는 메시지 타입 '{msg_type}'. 건너뜁니다.")
                    continue # 이 특정 메시지 건너뛰기

                # --- 첫 메시지 상태 확인 ---
                if idx == 0: # 첫 번째 메시지인 경우
                    if not send_success: # 전송 실패 시
                        error_reason = f"첫 메시지 ({msg_type}) 전송 실패."
                        log.error(error_reason)
                        group_status = "fail"
                        break # 이 사용자에 대한 나머지 메시지 전송 중단

                    # 지연 후 OCR을 통한 상태 확인
                    time.sleep(EXTRA_LONG_SLEEP) # 메시지 표시 및 상태 업데이트 가능성 대기
                    log.info("첫 메시지 상태 확인 중...")
                    status_ok, check_error = check_message_status(username, timestamp)
                    if not status_ok: # 상태 확인 실패 시
                        error_reason = f"첫 메시지 상태 확인 실패: {check_error}"
                        log.error(error_reason)
                        group_status = "fail"
                        break # 이 사용자에 대한 나머지 메시지 전송 중단
                    else: # 상태 확인 성공 시
                        log.info("첫 메시지 전송 및 상태 확인 성공.")
                        first_message_success = True
                else: # 두 번째 이후 메시지인 경우
                    # 실패 시 로그 남기고 계속 진행 (선택 사항)
                    if not send_success:
                        log.warning(f"{username}에게 메시지 #{idx+1} ({msg_type}) 전송 실패. 계속 진행합니다...")
                        # 필요하다면 이 특정 실패 기록 가능
            # --- 메시지 루프 종료 ---

            # 아직 fail/skip으로 설정되지 않은 경우 최종 그룹 상태 결정
            if group_status == "pending":
                if first_message_success: # 첫 메시지 성공 시
                    group_status = "success"
                    log.info(f"{username}에게 메시지 전송 성공 (첫 메시지 확인됨).")
                else: # 첫 메시지 성공 확인 안 된 경우 (이론상 도달하기 어려움)
                    group_status = "fail"
                    error_reason = error_reason or "특정 오류는 포착되지 않았지만 첫 메시지가 성공적으로 확인되지 않음."
                    log.error(f"{username}을(를) 실패로 표시. 사유: {error_reason}")

            # 다음 사용자 처리 전 채팅 창 닫기
            pyautogui.hotkey('command', 'w') # 창/탭 닫기
            time.sleep(MEDIUM_SLEEP)

        except Exception as e: # 예기치 않은 오류 발생 시
            log.error(f"사용자 {username} 처리 중 예상치 못한 오류 발생: {e}", exc_info=True)
            group_status = "fail"
            error_reason = f"처리되지 않은 예외: {e}"
            # 오류 발생 시 잠재적으로 열려 있는 창 닫기 시도
            try:
                focus_kakaotalk() # 닫기 명령 보내기 전 KakaoTalk 활성화 확인
                pyautogui.hotkey('command', 'w')
                time.sleep(MEDIUM_SLEEP)
            except Exception as close_e:
                log.warning(f"{username} 오류 후 창 닫기 실패: {close_e}")

        finally: # 항상 실행
            # 현재 사용자에 대한 결과 기록
            results.append({
                "username": username,
                "status": group_status,
                "reason": error_reason if error_reason else "" # 오류 사유가 있으면 기록
            })
            log.info(f"--- 사용자 처리 완료: {username} (상태: {group_status}) ---")
            time.sleep(SHORT_SLEEP) # 다음 사용자 전 짧은 지연

    log.info("모든 메시지 그룹 처리 완료.")
    return results