# flake8: noqa

import pyautogui
import time
import os
from AppKit import NSWorkspace
import ApplicationServices as AS
import datetime
import pathlib
import cv2
import numpy as np
import shutil
import pyperclip
import pytesseract
import subprocess
import logging
from pynput.keyboard import Controller, Key
import tempfile
from PIL import Image
import datetime
import subprocess
import os

keyboard = Controller()

# --- 상수 정의 ---
BASE_DIR = pathlib.Path(__file__).parent.absolute()
DEBUG_DIR = BASE_DIR / "debugs-screens" # 디버그 스크린샷 저장 경로
IMAGE_DIR = BASE_DIR / "images" # 이미지 파일 경로

# 이미지 경로
ICON_ADD = str(IMAGE_DIR / "add_icon.png") # 친구 추가 아이콘 이미지
# BTN_ADD = str(IMAGE_DIR / "add_btn.png") # find_button 리팩토링 후 사용되지 않는 것으로 보임

# 시간 상수 (초 단위)
SHORT_SLEEP = 0.2 # 짧은 대기 시간
MEDIUM_SLEEP = 0.6 # 중간 대기 시간
LONG_SLEEP = 1.2 # 긴 대기 시간
EXTRA_LONG_SLEEP = 2.0 # 매우 긴 대기 시간
CLICK_TIMEOUT = 10 # wait_and_click 함수 타임아웃

# UI 상호작용 상수
FRIENDS_TAB_SHORTCUT = '1' # 친구 탭 단축키 (Cmd+1)
CHAT_TAB_SHORTCUT = '2' # 채팅 탭 단축키 (Cmd+2)
SEARCH_SHORTCUT = 'f' # 검색 단축키 (Cmd+F)
PASTE_SHORTCUT = 'v' # 붙여넣기 단축키 (Cmd+V)
CLOSE_WINDOW_SHORTCUT = 'w' # 창 닫기 단축키 (Cmd+W)
TAB_KEY = 'tab' # 탭 키

# 이미지 매칭/찾기 상수
DEFAULT_CONFIDENCE = 0.7 # 템플릿 매칭 기본 신뢰도
ADD_ICON_REGION_SCALE_X_START = 0.7 # 친구 추가 아이콘 검색 영역 X 시작 비율
ADD_ICON_REGION_SCALE_WIDTH = 0.3 # 친구 추가 아이콘 검색 영역 너비 비율
ADD_ICON_REGION_SCALE_HEIGHT = 0.2 # 친구 추가 아이콘 검색 영역 높이 비율
ADD_ICON_MIN_AREA = 20 # 친구 추가 아이콘 최소 면적 (컨투어)
ADD_ICON_MAX_AREA = 500 # 친구 추가 아이콘 최대 면적 (컨투어)
ADD_ICON_MIN_ASPECT = 0.5 # 친구 추가 아이콘 최소 가로세로 비율
ADD_ICON_MAX_ASPECT = 1.5 # 친구 추가 아이콘 최대 가로세로 비율
ALT_CLICK_REL_X = 0.95 # 대체 클릭 X 상대 좌표
ALT_CLICK_REL_Y = 0.05 # 대체 클릭 Y 상대 좌표
BUTTON_SEARCH_AREA_SCALE = 0.5 # 버튼 검색 영역 비율 (하단 50%)
BUTTON_MIN_AREA = 2000 # 버튼 최소 면적 (컨투어)
BUTTON_MIN_WIDTH = 50 # 버튼 최소 너비 (컨투어)
BUTTON_MIN_ASPECT = 2.0 # 버튼 최소 가로세로 비율
BUTTON_MAX_ASPECT = 10.0 # 버튼 최대 가로세로 비율

# HSV 색상 범위 (필요시 조정)
YELLOW_LOWER = np.array([15, 60, 120]) # 노란색 하한값
YELLOW_UPPER = np.array([45, 255, 255]) # 노란색 상한값
GRAY_LOWER = np.array([0, 0, 80]) # 회색 하한값
GRAY_UPPER = np.array([180, 30, 200]) # 회색 상한값
 
# OCR 결과 문자열
OCR_SUCCESS = "친구 등록에 성공했습니다"
OCR_ALREADY_REGISTERED = "이미 등록된 친구입니다"
OCR_NOT_ALLOWED = "입력하신 번호를 친구로 추가할 수 없습니다"

# --- 로깅 설정 ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
log = logging.getLogger(__name__)

# --- 함수 정의 ---

# KakaoTalk 앱을 활성화합니다.
def focus_kakaotalk():
    """KakaoTalk 애플리케이션을 활성화합니다."""
    try:
        script = 'tell application "KakaoTalk" to activate'
        subprocess.run(['osascript', '-e', script], check=True, capture_output=True, timeout=5)
        time.sleep(SHORT_SLEEP) # 활성화 시간 확보
        log.info("KakaoTalk 앱 활성화 완료.")
        return True
    except subprocess.TimeoutExpired:
        log.error("AppleScript를 통한 KakaoTalk 활성화 시간 초과.")
        return False
    except subprocess.CalledProcessError as e:
        log.error(f"KakaoTalk 활성화 실패: {e.stderr.decode()}")
        return False
    except Exception as e:
        log.error(f"KakaoTalk 활성화 중 예상치 못한 오류 발생: {e}", exc_info=True)
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
        log.error(f"디버그 디렉토리 초기화 실패: {e}", exc_info=True)

# Quartz를 사용하여 KakaoTalk 메인 창의 영역을 가져옵니다.
def get_kakaotalk_window_region():
    """
    Accessibility API를 사용해 KakaoTalk 프로세스의 포커스된 창 위치와 크기를 반환합니다.
    실패 시 전체 화면을 반환합니다.
    """
    try:
        # KakaoTalk 프로세스 찾기: 번들ID 또는 로컬라이즈드 이름 매칭
        workspace = NSWorkspace.sharedWorkspace()
        kakao_pid = None
        for app in workspace.runningApplications():
            name = app.localizedName()
            bundle_id = app.bundleIdentifier() or ""
            if bundle_id == "com.kakao.KakaoTalk" or name in ("KakaoTalk", "카카오톡"):
                kakao_pid = app.processIdentifier()
                break
        if kakao_pid is None:
            raise Exception("KakaoTalk 프로세스를 찾을 수 없습니다.")
        # Accessibility API로 앱 참조 생성
        app_ref = AS.AXUIElementCreateApplication(kakao_pid)
        # 포커스된 창의 AXValueRef 획득
        _, front_win = AS.AXUIElementCopyAttributeValue(app_ref, AS.kAXFocusedWindowAttribute, None)
        _, pos_ref = AS.AXUIElementCopyAttributeValue(front_win, AS.kAXPositionAttribute, None)
        _, size_ref = AS.AXUIElementCopyAttributeValue(front_win, AS.kAXSizeAttribute, None)
        # use AXValueGetValue with valuePtr=None
        success, point = AS.AXValueGetValue(pos_ref, AS.kAXValueCGPointType, None)
        success2, size = AS.AXValueGetValue(size_ref, AS.kAXValueCGSizeType, None)
        x, y = int(point.x), int(point.y)
        w, h = int(size.width), int(size.height)
        log.info(f"Accessibility API로 KakaoTalk 창 영역: ({x}, {y}, {w}, {h})")
        return (x, y, w, h)
    except Exception as e:
        log.error(f"Accessibility API로 KakaoTalk 창 위치 가져오기 실패: {e}", exc_info=True)
        sw, sh = pyautogui.size()
        return (0, 0, sw, sh)

def get_kakaotalk_popup_or_main_window_region():
    """
    KakaoTalk의 모든 창 중에서 (1) 팝업(모달) 창이 있으면 그 창의 좌표를,
    (2) 없으면 메인창 좌표를 반환. 둘 다 없으면 전체 화면 반환.
    """
    # Accessibility API로 KakaoTalk의 모든 윈도우 조회
    try:
        workspace = NSWorkspace.sharedWorkspace()
        kakao_pid = None
        for app in workspace.runningApplications():
            if app.localizedName() in ("KakaoTalk", "카카오톡"):
                kakao_pid = app.processIdentifier()
                break
        if kakao_pid is None:
            raise Exception("KakaoTalk 프로세스를 찾을 수 없습니다.")
        app_ref = AS.AXUIElementCreateApplication(kakao_pid)
        _, windows = AS.AXUIElementCopyAttributeValue(app_ref, AS.kAXWindowsAttribute, None)
        # 모달 팝업 윈도우 찾기 (제목에 '친구 추가' 포함)
        for win in windows or []:
            _, title = AS.AXUIElementCopyAttributeValue(win, AS.kAXTitleAttribute, None)
            if isinstance(title, str) and ("친구 추가" in title or "친구등록" in title):
                # 위치/크기 추출
                _, pos = AS.AXUIElementCopyAttributeValue(win, AS.kAXPositionAttribute, None)
                _, size = AS.AXUIElementCopyAttributeValue(win, AS.kAXSizeAttribute, None)
                x, y = int(pos.x), int(pos.y)
                w, h = int(size.width), int(size.height)
                log.info(f"AXUI 팝업 윈도우 검출: ({x}, {y}, {w}, {h}) (title={title})")
                return {"id": None, "bounds": (x, y, w, h)}
    except Exception as e:
        log.warning(f"AXUI 팝업 검출 실패: {e}")
    # 팝업 못 찾으면 포커스된 창(메인/모달) 반환
    bounds = get_kakaotalk_window_region()
    return {"id": None, "bounds": bounds}

def capture_region(region, save_path=None):
    """
    주어진(region) 좌표(x,y,w,h)로 screencapture를 사용해 스크린샷을 저장하고 PIL Image로 반환합니다.
    멀티모니터 환경의 음수 좌표를 지원합니다.
    """
    x, y, w, h = region
    region_str = f"{x},{y},{w},{h}"
    if save_path:
        output = str(save_path)
    else:
        output = os.path.join(tempfile.gettempdir(), f"region_capture_{datetime.datetime.now().strftime('%Y%m%d%H%M%S')}.png")
    subprocess.run(['screencapture', '-x', '-R', region_str, output], check=True)
    return Image.open(output)

# 화면과 템플릿 이미지를 매칭을 위해 준비합니다 (컬러 유지).
# 템플릿이 화면 영역보다 크면 리사이즈합니다.
def preprocess_image(image_path, region):
    """
    화면과 템플릿 이미지를 매칭을 위해 준비합니다 (컬러 유지).
    템플릿이 화면 영역보다 크면 리사이즈합니다.
    성공 시 (screen_np, template), 실패 시 (None, None) 반환.
    """
    try:
        # 화면 영역 캡처
        screen = pyautogui.screenshot(region=region)
        screen_np = np.array(screen) # RGB 형식
        screen_np = cv2.cvtColor(screen_np, cv2.COLOR_RGB2BGR) # OpenCV 일관성을 위해 BGR로 변환

        # 템플릿 이미지 컬러로 로드
        template = cv2.imread(image_path, cv2.IMREAD_COLOR)
        if template is None:
            log.error(f"템플릿 이미지 로드 실패: {image_path}")
            return None, None

        # 템플릿이 화면 영역보다 큰지 확인
        t_h, t_w = template.shape[:2]
        s_h, s_w = screen_np.shape[:2]

        if (t_h > s_h or t_w > s_w):
            log.warning(f"템플릿 ({t_w}x{t_h})이 화면 영역 ({s_w}x{s_h})보다 큽니다. 리사이징합니다.")
            # 화면 영역에 맞게 축소 비율 계산 (약간의 여유 포함)
            height_ratio = s_h / t_h * 0.95
            width_ratio = s_w / t_w * 0.95
            scale_factor = min(height_ratio, width_ratio)

            if scale_factor <= 0:
                 log.error("템플릿 리사이즈 중 유효하지 않은 스케일 팩터 발생. 진행 불가.")
                 return screen_np, None

            new_h = int(t_h * scale_factor)
            new_w = int(t_w * scale_factor)
            template = cv2.resize(template, (new_w, new_h))
            log.info(f"템플릿 리사이즈 완료: ({new_w}x{new_h})")

        return screen_np, template

    except Exception as e:
        log.error(f"{image_path} 이미지 전처리 중 오류 발생: {e}", exc_info=True)
        return None, None

# 오른쪽 상단 영역에서 컨투어 감지를 사용하여 '+' 친구 추가 아이콘을 찾습니다.
def find_add_friend_icon_direct(region):
    """
    오른쪽 상단 영역에서 컨투어 감지를 사용하여 '+' 친구 추가 아이콘을 찾습니다.
    화면 좌표 (x, y) 또는 None을 반환합니다.
    """
    timestamp = datetime.datetime.now().strftime('%Y%m%d%H%M%S')
    try:
        # 비율 상수를 기반으로 오른쪽 상단 검색 영역 정의
        r_x, r_y, r_w, r_h = region
        search_x = r_x + int(r_w * ADD_ICON_REGION_SCALE_X_START)
        search_y = r_y
        search_w = int(r_w * ADD_ICON_REGION_SCALE_WIDTH)
        search_h = int(r_h * ADD_ICON_REGION_SCALE_HEIGHT)
        top_right_region = (search_x, search_y, search_w, search_h)

        # 특정 영역 캡처 (screencapture 사용)
        debug_top_right_path = DEBUG_DIR / f"top_right_{timestamp}.png"
        top_right_img = capture_region(top_right_region, debug_top_right_path)
        if (top_right_img is None):
            log.error("오른쪽 상단 영역 스크린샷 캡처 실패.")
            return None

        log.debug(f"오른쪽 상단 영역 저장됨: {debug_top_right_path}")

        # 컨투어 감지를 위한 이미지 처리
        top_right_np = np.array(top_right_img)
        top_right_np = cv2.cvtColor(top_right_np, cv2.COLOR_RGB2BGR)
        top_right_gray = cv2.cvtColor(top_right_np, cv2.COLOR_BGR2GRAY)
        # 다양한 배경에서 더 나은 결과를 위해 적응형 임계값 또는 Otsu 방법 사용
        _, binary = cv2.threshold(top_right_gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        # 선택 사항: 노이즈 제거를 위해 모폴로지 연산(침식/팽창) 적용

        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        debug_image = top_right_np.copy()
        potential_icons = [] # 잠재적 아이콘 후보 리스트

        for contour in contours:
            area = cv2.contourArea(contour)
            # 면적 기준으로 필터링
            if ADD_ICON_MIN_AREA < area < ADD_ICON_MAX_AREA:
                x, y, w, h = cv2.boundingRect(contour)
                aspect_ratio = float(w) / h if h > 0 else 0
                # 가로세로 비율 및 '+' 모양 특성 확인 (예: solidity, circularity)
                if ADD_ICON_MIN_ASPECT < aspect_ratio < ADD_ICON_MAX_ASPECT:
                    center_x = x + w // 2
                    center_y = y + h // 2
                    potential_icons.append((center_x, center_y, area, aspect_ratio))
                    # 디버그 이미지에 후보 표시
                    cv2.rectangle(debug_image, (x, y), (x + w, y + h), (0, 255, 0), 1)
                    cv2.circle(debug_image, (center_x, center_y), 3, (0, 0, 255), -1)

        debug_contours_path = DEBUG_DIR / f"add_icon_candidates_{timestamp}.png"
        cv2.imwrite(str(debug_contours_path), debug_image)
        log.debug(f"아이콘 후보 저장됨: {debug_contours_path}")

        if potential_icons:
            # 최적 후보 선택 (예: 가장 오른쪽에 있거나 특정 크기 범위)
            potential_icons.sort(key=lambda item: (-item[0], item[2])) # 가장 오른쪽 우선, 다음으로 작은 면적 우선
            best_icon_local_x, best_icon_local_y, _, _ = potential_icons[0]

            # 절대 화면 좌표 계산
            screen_x = top_right_region[0] + best_icon_local_x
            screen_y = top_right_region[1] + best_icon_local_y

            # 디버그 이미지에 선택된 아이콘 표시
            cv2.circle(debug_image, (best_icon_local_x, best_icon_local_y), 7, (255, 0, 0), 2)
            selected_icon_path = DEBUG_DIR / f"add_icon_selected_{timestamp}.png"
            cv2.imwrite(str(selected_icon_path), debug_image)
            log.debug(f"선택된 아이콘 저장됨: {selected_icon_path}")

            log.info(f"친구 추가 아이콘 직접 찾기 성공: ({screen_x}, {screen_y})")
            return screen_x, screen_y

        log.warning("직접 컨투어 방식으로 친구 추가 아이콘을 찾지 못했습니다.")
        return None

    except Exception as e:
        log.error(f"친구 추가 아이콘 직접 찾기 중 오류 발생: {e}", exc_info=True)
        return None

# 대체 방법: 오른쪽 상단 모서리의 미리 정의된 상대 위치를 클릭합니다.
def alt_add_friend_click(region):
    """
    대체 방법: 오른쪽 상단 모서리의 미리 정의된 상대 위치를 클릭합니다.
    이미지 감지보다 신뢰성이 낮습니다. 클릭 시도 시 True를 반환합니다.
    """
    try:
        r_x, r_y, r_w, r_h = region
        # 상대 위치 상수를 기반으로 절대 좌표 계산
        click_x = r_x + int(r_w * ALT_CLICK_REL_X)
        click_y = r_y + int(r_h * ALT_CLICK_REL_Y)

        log.info(f"대체 클릭 시도 (상대 위치): ({click_x}, {click_y})")

        pyautogui.moveTo(click_x, click_y, duration=0.1)
        time.sleep(SHORT_SLEEP)
        pyautogui.click()
        time.sleep(MEDIUM_SLEEP) # 클릭 후 동작 시간 확보
        log.info("대체 클릭 수행 완료.")
        return True

    except Exception as e:
        log.error(f"대체 클릭 중 오류 발생: {e}", exc_info=True)
        return False

# 지정된 영역 내에서 색상(노란색 또는 회색)을 기반으로 버튼을 찾습니다.
def find_button(region, button_type="yellow", search_area="bottom"):
    """
    지정된 영역 내에서 색상(노란색 또는 회색)을 기반으로 버튼을 찾습니다.
    버튼 중앙 좌표 (x, y) 또는 None을 반환합니다.
    """
    log.debug(f"{search_area} 영역에서 {button_type} 버튼 검색 중.")
    try:
        r_x, r_y, r_w, r_h = region
        search_region = region

        # 하단 부분만 검색하는 경우 영역 조정
        if search_area == "bottom":
            search_y = r_y + int(r_h * (1 - BUTTON_SEARCH_AREA_SCALE))
            search_h = int(r_h * BUTTON_SEARCH_AREA_SCALE)
            search_region = (r_x, search_y, r_w, search_h)

        # 검색 영역 캡처 (screencapture 사용)
        timestamp = datetime.datetime.now().strftime('%Y%m%d%H%M%S')
        mask_img = capture_region(search_region, DEBUG_DIR / f"btn_region_{button_type}_{timestamp}.png")
        screen = mask_img
        if screen is None:
            log.error("버튼 검색을 위한 화면 영역 캡처 실패.")
            return None
        screen_np = cv2.cvtColor(np.array(screen), cv2.COLOR_RGB2BGR)

        # 색상 마스킹
        hsv = cv2.cvtColor(screen_np, cv2.COLOR_BGR2HSV)
        if button_type == "yellow":
            mask = cv2.inRange(hsv, YELLOW_LOWER, YELLOW_UPPER)
        elif button_type == "gray":
            mask = cv2.inRange(hsv, GRAY_LOWER, GRAY_UPPER)
        else:
            log.error(f"잘못된 button_type: {button_type}. 'yellow' 또는 'gray'를 사용하세요.")
            return None

        # 선택 사항: 마스크 정리를 위한 모폴로지 연산
        # kernel = np.ones((3,3), np.uint8)
        # mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)
        # mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=1)

        # 컨투어 찾기
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        # 버튼을 찾기 위한 컨투어 필터링
        found_buttons = []
        for contour in contours:
            area = cv2.contourArea(contour)
            # 면적 기준으로 필터링
            if area > BUTTON_MIN_AREA:
                x, y, w, h = cv2.boundingRect(contour)
                # 너비 및 가로세로 비율 기준으로 필터링
                if w > BUTTON_MIN_WIDTH and h > 0 and BUTTON_MIN_ASPECT < (w / h) < BUTTON_MAX_ASPECT:
                    center_x = search_region[0] + x + w // 2
                    center_y = search_region[1] + y + h // 2
                    found_buttons.append((center_x, center_y, area))
                    log.debug(f"잠재적 버튼 발견: 중앙=({center_x}, {center_y}), 면적={area}, 사각형=({x},{y},{w},{h})")

        if not found_buttons:
            log.debug(f"기준에 맞는 {button_type} 버튼을 찾지 못했습니다.")
            # 디버깋을 위해 마스크 저장
            timestamp = datetime.datetime.now().strftime('%Y%m%d%H%M%S')
            mask_path = DEBUG_DIR / f"{button_type}_mask_{timestamp}.png"
            cv2.imwrite(str(mask_path), mask)
            log.debug(f"버튼 검색 마스크 저장됨: {mask_path}")
            return None

        # 최적 버튼 선택 (예: 가장 큰 면적)
        found_buttons.sort(key=lambda item: item[2], reverse=True)
        best_x, best_y, best_area = found_buttons[0]
        log.info(f"{button_type} 버튼 발견: 위치=({best_x}, {best_y}), 면적={best_area}.")
        return best_x, best_y

    except Exception as e:
        log.error(f"{button_type} 버튼 찾기 중 오류 발생: {e}", exc_info=True)
        return None

# 화면에 이미지가 나타날 때까지 기다렸다가 클릭합니다.
# '친구 추가' 아이콘에 대한 특별 처리를 사용합니다.
def wait_and_click(image_path, confidence=DEFAULT_CONFIDENCE, timeout=CLICK_TIMEOUT):
    """
    화면에 이미지가 나타날 때까지 기다렸다가 클릭합니다.
    '친구 추가' 아이콘에 대한 특별 처리를 사용합니다.
    성공 시 True, 실패 시 TimeoutError 발생.
    """
    log.info(f"{timeout}초 동안 {os.path.basename(image_path)} 찾아서 클릭 대기 중...")

    if not os.path.exists(image_path):
        log.error(f"이미지 파일 없음: {image_path}")
        raise FileNotFoundError(f"이미지 파일 없음: {image_path}")

    start_time = time.time()
    region = get_kakaotalk_window_region()
    if not region:
        log.error("클릭 진행 불가, KakaoTalk 창 영역 가져오기 실패.")
        raise Exception("KakaoTalk 창 영역 가져오기 실패")

    # --- 친구 추가 아이콘 특별 처리 ---
    if "add_icon.png" in image_path:
        log.debug("친구 추가 아이콘 특별 감지 시도 중.")
        # 방법 1: 직접 컨투어 감지
        icon_pos = find_add_friend_icon_direct(region)
        if (icon_pos):
            pyautogui.moveTo(icon_pos[0], icon_pos[1], duration=0.1)
            time.sleep(SHORT_SLEEP)
            pyautogui.click()
            log.info(f"직접 감지로 친구 추가 아이콘 클릭 성공: {icon_pos}.")
            return True
        else:
            log.warning("직접 친구 추가 아이콘 감지 실패.")

        # 방법 2: 대체 상대 위치 클릭 (아이콘 감지 실패 시 대체)
        log.debug("친구 추가 아이콘 대체 클릭 시도 중.")
        if alt_add_friend_click(region):
            log.info("대체 방식으로 친구 추가 아이콘 클릭 성공.")
            # 아이콘을 찾았는지 확인할 수 없지만 클릭이 작동했다고 가정
            return True
        else:
            log.error("친구 추가 아이콘 대체 클릭 방식도 실패.")
            # 아이콘에 대한 마지막 수단으로 템플릿 매칭으로 넘어감
            # 또는 이 방법들이 결정적이어야 한다면 오류 발생시킴
            # 현재는 템플릿 매칭으로 넘어감.
            log.warning("친구 추가 아이콘 템플릿 매칭으로 대체 시도.")

    # --- 일반 템플릿 매칭 ---
    while time.time() - start_time < timeout:
        timestamp = datetime.datetime.now().strftime('%Y%m%d%H%M%S')
        try:
            # 창 이동/리사이즈 경우를 대비해 영역 새로고침
            current_region = get_kakaotalk_window_region()
            if not current_region:
                log.warning("대기 중 KakaoTalk 창 영역 손실. 재시도 중...")
                time.sleep(MEDIUM_SLEEP)
                continue

            # 화면 및 템플릿 전처리 (컬러)
            screen_bgr, template_bgr = preprocess_image(image_path, current_region)
            if screen_bgr is None or template_bgr is None:
                log.warning("이미지 전처리 실패. 재시도 중...")
                time.sleep(MEDIUM_SLEEP)
                continue

            # 템플릿 매칭을 위해 그레이스케일로 변환
            screen_gray = cv2.cvtColor(screen_bgr, cv2.COLOR_BGR2GRAY)
            template_gray = cv2.cvtColor(template_bgr, cv2.COLOR_BGR2GRAY)

            # 전처리 후 잠재적 리사이즈 후 크기 다시 확인
            if template_gray.shape[0] > screen_gray.shape[0] or template_gray.shape[1] > screen_gray.shape[1]:
                log.error("전처리 후에도 템플릿이 여전히 화면 영역보다 큽니다.")
                time.sleep(MEDIUM_SLEEP)
                continue

            # 템플릿 매칭 수행
            result = cv2.matchTemplate(screen_gray, template_gray, cv2.TM_CCOEFF_NORMED)
            _, max_val, _, max_loc = cv2.minMaxLoc(result)
            log.debug(f"템플릿 매칭 점수: {max_val:.4f} (신뢰도 임계값: {confidence})")

            if max_val >= confidence:
                # 화면 기준 중앙 좌표 계산
                t_h, t_w = template_gray.shape # 그레이스케일 크기 사용
                match_x, match_y = max_loc
                center_x = current_region[0] + match_x + t_w // 2
                center_y = current_region[1] + match_y + t_h // 2

                # 디버그: 컬러 화면 캡처에 사각형 그리기
                debug_screen = screen_bgr.copy()
                cv2.rectangle(debug_screen, (match_x, match_y), (match_x + t_w, match_y + t_h), (0, 0, 255), 2)
                debug_marked_path = DEBUG_DIR / f"matched_{os.path.basename(image_path)}_{timestamp}.png"
                cv2.imwrite(str(debug_marked_path), debug_screen)
                log.debug(f"매칭 성공. 표시된 이미지 저장됨: {debug_marked_path}")

                # 중앙 클릭
                pyautogui.moveTo(center_x, center_y, duration=0.1)
                time.sleep(SHORT_SLEEP)
                pyautogui.click()
                log.info(f"{os.path.basename(image_path)} 클릭 성공: 위치=({center_x}, {center_y}), 점수={max_val:.4f}.")
                return True
            else:
                log.debug("매칭 점수가 임계값 미만입니다.")

        except Exception as e:
            log.error(f"템플릿 매칭 루프 중 오류 발생: {e}", exc_info=True)

        time.sleep(MEDIUM_SLEEP) # 재시도 전 대기

    # 타임아웃 도달
    log.error(f"타임아웃: {timeout}초 내에 {os.path.basename(image_path)}를 찾지 못했습니다.")
    # 실패 시 마지막 화면 캡처 저장
    try:
        fail_region = get_kakaotalk_window_region() or (0,0, pyautogui.size()[0], pyautogui.size()[1])
        fail_timestamp = datetime.datetime.now().strftime('%Y%m%d%H%M%S')
        fail_path = DEBUG_DIR / f"fail_capture_{os.path.basename(image_path)}_{fail_timestamp}.png"
        capture_region(fail_region, fail_path).save(str(fail_path))
        log.debug(f"실패 스크린샷 저장됨: {fail_path}")
    except Exception as e:
        log.error(f"실패 스크린샷 저장 실패: {e}")

    raise TimeoutError(f"{timeout}초 내에 이미지 {os.path.basename(image_path)}를 찾지 못했습니다.")

# Cmd+1을 사용하여 KakaoTalk 친구 탭으로 이동합니다.
def navigate_to_friends_tab():
    """Cmd+1을 사용하여 KakaoTalk 친구 탭으로 이동합니다."""
    log.info("친구 탭으로 이동 중...")
    try:
        keyboard.press(Key.cmd)
        keyboard.press(FRIENDS_TAB_SHORTCUT)
        keyboard.release(FRIENDS_TAB_SHORTCUT)
        keyboard.release(Key.cmd)
        time.sleep(MEDIUM_SLEEP) # 탭 로딩 시간 확보
        log.info("친구 탭으로 이동 완료.")
        return True
    except Exception as e:
        log.error(f"친구 탭 이동 실패: {e}", exc_info=True)
        return False

# 사용자 이름과 전화번호를 사용하여 단일 친구를 추가합니다.
def add_friend(username, phone):
    """사용자 이름과 전화번호를 사용하여 단일 친구를 추가합니다."""
    log.info(f"친구 추가 시도: 사용자명='{username}', 전화번호='{phone}'")
    status = "fail" # 기본 상태
    reason = "알 수 없는 오류" # 기본 사유

    try:
        # KakaoTalk이 활성화되어 있고 친구 탭에 있는지 확인
        if not focus_kakaotalk():
            raise Exception("초기 KakaoTalk 활성화 실패.")
        if not navigate_to_friends_tab():
            raise Exception("친구 탭 이동 실패.")

        # 1. 친구 추가 아이콘 클릭
        log.debug("친구 추가 아이콘 클릭 중...")
        wait_and_click(ICON_ADD, confidence=0.6, timeout=10) # 필요시 특정 신뢰도 사용
        time.sleep(MEDIUM_SLEEP) # 친구 추가 대화 상자 대기

        # 2. 사용자 이름 입력 (선택 사항, 전화번호로 추가 시 필요 없을 수 있음)
        log.debug(f"사용자 이름 입력: {username}")
        pyperclip.copy(username)
        time.sleep(SHORT_SLEEP)
        keyboard.press(Key.cmd)
        keyboard.press(PASTE_SHORTCUT)
        keyboard.release(PASTE_SHORTCUT)
        keyboard.release(Key.cmd)
        time.sleep(SHORT_SLEEP)
        for _ in range(3):
            keyboard.press(Key.tab)
            keyboard.release(Key.tab)
            time.sleep(0.2)
        time.sleep(SHORT_SLEEP)

        # 3. 전화번호 입력
        # 전화번호 입력 필드 찾기. 탭 또는 클릭 필요할 수 있음.
        # 친구 추가 아이콘 클릭 후 또는 사용자 이름 입력 + 탭 후에 전화번호 필드가 활성화된다고 가정
        log.debug(f"전화번호 입력: {phone}")

        # 전화번호 붙여넣기
        pyperclip.copy(phone)
        time.sleep(SHORT_SLEEP)
        keyboard.press(Key.cmd)
        keyboard.press(PASTE_SHORTCUT)
        keyboard.release(PASTE_SHORTCUT)
        keyboard.release(Key.cmd)
        time.sleep(MEDIUM_SLEEP)

        # 4. 추가/확인 버튼 클릭 (보통 노란색)
        log.debug("노란색 '추가' 버튼 검색 중...")
        region = get_kakaotalk_window_region()
        if not region: raise Exception("버튼 검색 전 KakaoTalk 창 영역 손실.")

        button_pos = find_button(region, button_type="yellow", search_area="bottom")
        if not button_pos:
            # 대체: 버튼을 찾지 못한 경우 Enter 키 누르기 시도
            log.warning("색상 감지로 노란색 버튼을 찾지 못했습니다. Enter 키 누르기 시도.")
            keyboard.press(Key.enter)
            keyboard.release(Key.enter)
            # raise Exception("노란색 '추가' 버튼을 찾을 수 없습니다.") # 또는 Enter 시도
        else:
            pyautogui.moveTo(button_pos[0], button_pos[1], duration=0.1)
            pyautogui.click()
            log.info("노란색 버튼 클릭 완료.")

        time.sleep(LONG_SLEEP) # 확인 대화 상자/메시지 대기

        # 5. OCR을 통해 결과 확인
        log.debug("OCR 캡처용 팝업 영역 재설정 중...")
        popup_bounds = get_kakaotalk_popup_or_main_window_region().get('bounds')
        if not popup_bounds:
            raise Exception("OCR 확인 전 KakaoTalk 팝업/메인 창 영역 손실.")
        x, y, w, h = popup_bounds
        # 좌측 50% 제거, 우측 부분 = (50% + 25%)
        left_cut_ratio = 0.5
        right_extend_ratio = left_cut_ratio * 0.5
        cap_x = x + int(w * left_cut_ratio)
        cap_w = int(w * (1 - left_cut_ratio + right_extend_ratio))
        # 상하 20%씩 줄이기
        top_cut_ratio = 0.2
        bottom_cut_ratio = 0.2
        cap_y = y + int(h * top_cut_ratio)
        cap_h = int(h * (1 - top_cut_ratio - bottom_cut_ratio))
        capture_reg = (cap_x, cap_y, cap_w, cap_h)
        timestamp = datetime.datetime.now().strftime('%Y%m%d%H%M%S')
        popup_path = DEBUG_DIR / f"popup_capture_{timestamp}.png"
        result_img = capture_region(capture_reg, popup_path)
        log.debug(f"OCR 캡처용 영역 스크린샷 저장됨: {popup_path}")

        # OCR 수행
        custom_config = r'--oem 3 --psm 6 -l kor+eng'
        result_text = pytesseract.image_to_string(result_img, config=custom_config, lang="kor+eng")
        log.info(f"OCR 결과 텍스트: '{result_text.strip()}'")

        # OCR 결과에서 줄바꿈, 공백 제거
        normalized_text = result_text.replace('\n', '').replace('\r', '').replace(' ', '')
        OCR_SUCCESS_PATTERNS = [
            "친구등록이완료되었습니다",
            "친구등록에성공했습니다",
            "친구추가가완료되었습니다",
            "친구추가에성공했습니다"
        ]
        if any(success_str in normalized_text for success_str in OCR_SUCCESS_PATTERNS):
            status = "success"
            reason = "친구 추가 성공."
            log.info(f"[성공] {reason}")
        elif OCR_ALREADY_REGISTERED.replace(' ', '') in normalized_text:
            status = "already_registered"
            reason = "이미 등록된 친구입니다."
            log.warning(f"[건너뜀] {reason}")
        elif OCR_NOT_ALLOWED.replace(' ', '') in normalized_text:
            status = "not_allowed"
            reason = "이 번호는 친구로 추가할 수 없습니다."
            log.error(f"[실패] {reason}")
        else:
            status = "fail"
            reason = f"OCR을 통한 결과 메시지 인식 불가: {result_text.strip()}"
            log.error(f"[실패] {reason}")

        # 친구 추가 대화 상자/창 닫기 (Cmd+W가 작동한다고 가정)
        keyboard.press(Key.cmd)
        keyboard.press('w')
        keyboard.release('w')
        keyboard.release(Key.cmd)
        time.sleep(MEDIUM_SLEEP)

    except FileNotFoundError as e:
        reason = str(e)
        log.error(f"{username} 친구 추가 실패: {reason}")
        # 상태는 'fail' 유지
    except TimeoutError as e:
        reason = str(e)
        log.error(f"{username} 친구 추가 실패: {reason}")
        # 상태는 'fail' 유지
    except Exception as e:
        reason = f"예상치 못한 오류 발생: {e}"
        log.error(f"{username} 친구 추가 실패: {reason}", exc_info=True)
        # 상태는 'fail' 유지
        # 오류 발생 시 창 닫기 시도
        try:
            if focus_kakaotalk():
                keyboard.press(Key.cmd)
                keyboard.press('w')
                keyboard.release('w')
                keyboard.release(Key.cmd)
                time.sleep(MEDIUM_SLEEP)
        except Exception as close_e:
            log.warning(f"오류 후 창 닫기 실패: {close_e}")

    return {"username": username, "phone": phone, "status": status, "reason": reason}

# 리스트에서 여러 친구를 KakaoTalk에 추가합니다.
def add_friends_via_kakao(friends_data):
    """
    리스트에서 여러 친구를 KakaoTalk에 추가합니다.

    Args:
        friends_data (list): [{"username": 이름, "phone": 번호}, ...] 형식의 딕셔너리 리스트

    Returns:
        list: 각 친구에 대한 결과 딕셔너리 리스트
    """
    log.info(f"{len(friends_data)}명의 친구 일괄 추가 시작.")
    clear_debug_dir()
    results = []

    # 초기 활성화 확인
    if not focus_kakaotalk():
        log.critical("일괄 추가 시작 불가: 초기 KakaoTalk 활성화 실패.")
        # 모두 실패로 표시
        for friend in friends_data:
             results.append({
                "username": friend.get('username', 'N/A'),
                "phone": friend.get('phone', 'N/A'),
                "status": "fail",
                "reason": "초기 KakaoTalk 활성화 실패."
             })
        return results

    for friend in friends_data:
        # 사용자 이름 없으면 전화번호 기반으로 생성
        username = friend.get('username', f"UnknownUser_{friend.get('phone', 'NoPhone')}")
        phone = friend.get('phone')

        if not phone:
            log.warning(f"전화번호 누락으로 친구 '{username}' 건너뜀.")
            results.append({
                "username": username,
                "phone": phone,
                "status": "skip",
                "reason": "전화번호 누락"
            })
            continue

        try:
            result = add_friend(username, phone)
            results.append(result)
            # 친구 추가 사이에 약간의 지연 추가
            time.sleep(SHORT_SLEEP)
        except Exception as e:
            # add_friend 자체에서 발생한 예외 처리
            log.error(f"{username} 처리 중 예외 발생: {e}", exc_info=True)
            results.append({
                "username": username,
                "phone": phone,
                "status": "fail",
                "reason": f"add_friend 내 처리되지 않은 예외: {e}"
            })
            # 다음 친구를 위해 활성화 복구 시도
            if not focus_kakaotalk():
                 log.critical("오류 후 KakaoTalk 활성화 손실, 일괄 추가 계속 불가.")
                 # 선택 사항: 남은 친구들을 실패로 표시
                 break # 추가 친구 처리 중단

    log.info(f"친구 일괄 추가 완료. 처리 결과: {len(results)}건.")
    return results
