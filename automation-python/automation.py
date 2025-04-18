import pyautogui
import time
import os
import Quartz
from PIL import ImageDraw
import datetime
import pathlib
import cv2
import numpy as np
import shutil
import pyperclip  # Make sure this is imported at the top
import pytesseract
import subprocess

# 절대 경로로 이미지 파일 지정
BASE_DIR = pathlib.Path(__file__).parent.absolute()
ICON_ADD = str(BASE_DIR / "images/add_icon.png")
BTN_ADD = str(BASE_DIR / "images/add_btn.png")
DEBUG_DIR = BASE_DIR / "debugs-screens"


def focus_kakaotalk():
    script = 'tell application "KakaoTalk" to activate'
    subprocess.run(['osascript', '-e', script])
    time.sleep(0.5)  # 창 활성화를 위한 대기 시간 추가


# 디버그 폴더 생성 및 초기화 함수
def clear_debug_dir():
    if os.path.exists(DEBUG_DIR):
        shutil.rmtree(DEBUG_DIR)
    os.makedirs(DEBUG_DIR, exist_ok=True)
    print(f"[INFO] 디버그 폴더 재생성 완료: {DEBUG_DIR}")


def get_kakaotalk_window_region():
    """
    카카오톡 창 위치와 크기를 반환하는 함수 (로깅 최소화)
    """
    # 기존 Quartz 방식도 동시에 시도
    window_list = Quartz.CGWindowListCopyWindowInfo(
        Quartz.kCGWindowListOptionOnScreenOnly, Quartz.kCGNullWindowID
    )

    # 로깅 제거: print(f"[DEBUG] Quartz 창 개수: {len(window_list)}")

    # 모든 창을 출력하고 카카오톡 관련 창 찾기
    possible_names = ["kakao", "kakaotalk", "카카오", "카카오톡"]
    kakao_windows = []

    for i, window in enumerate(window_list):
        owner_name = window.get("kCGWindowOwnerName", "")
        window_name = window.get("kCGWindowName", "")
        bounds = window.get("kCGWindowBounds", {})
        # 로깅 최소화: 카카오톡 창만 기록

        # 카카오톡 창 후보 추가 조건 확장
        is_kakao = False
        for name in possible_names:
            if (name in owner_name.lower()) or (name in window_name.lower()):
                is_kakao = True
                break

        if is_kakao:
            kakao_windows.append((owner_name, window_name, bounds))
            print(f"[DEBUG] 카카오톡 창 발견: '{owner_name}' / '{window_name}'")
            x = int(bounds["X"])
            y = int(bounds["Y"])
            w = int(bounds["Width"])
            h = int(bounds["Height"])
            if w > 200 and h > 200:  # 최소 크기 조건 완화
                print(f"[DEBUG] 카카오톡 창 선택: {x=}, {y=}, {w=}, {h=}")
                return (x, y, w, h)

    # 카카오톡 창을 못 찾은 경우
    if not kakao_windows:
        print("[DEBUG] 카카오톡 창을 찾을 수 없어 전체 화면 영역을 사용합니다.")
        screen_width, screen_height = pyautogui.size()
        return (0, 0, screen_width, screen_height)
    
    # 대체 방법
    for owner_name, window_name, bounds in kakao_windows:
        x = int(bounds["X"])
        y = int(bounds["Y"])
        w = int(bounds["Width"])
        h = int(bounds["Height"])
        print(f"[DEBUG] 대안 카카오톡 창 사용: {x=}, {y=}, {w=}, {h=}")
        return (x, y, w, h)

    # 전체 화면 영역 사용
    screen_width, screen_height = pyautogui.size()
    print("[DEBUG] 모든 방법 실패. 전체 화면 영역을 사용합니다.")
    return (0, 0, screen_width, screen_height)


def preprocess_image(image_path, region):
    """
    이미지 전처리 함수 (흑백 변환 제거, 컬러 유지)
    """
    # 캡처된 화면을 OpenCV 형식 (컬러)으로 변환
    screen = pyautogui.screenshot(region=region)
    screen_np = np.array(screen)  # [H, W, 3] (RGB)

    # 템플릿 이미지를 컬러로 로드
    template = cv2.imread(image_path, cv2.IMREAD_COLOR)  # 그레이스케일 대신 컬러

    # 특별히 add_btn.png 파일인 경우 강제로 형태 조정
    if "add_btn.png" in image_path and template.shape[1] > template.shape[0] * 3:
        print("[INFO] 노란색 버튼 템플릿 형태 조정 중...")
        new_width = min(300, template.shape[1])
        new_height = 50
        template = cv2.resize(template, (new_width, new_height))
        print(f"[INFO] 버튼 템플릿 형태 조정 완료: {template.shape}")

    # 템플릿 크기가 화면보다 큰지 확인 (컬러 기준)
    if (template.shape[0] > screen_np.shape[0]) or (template.shape[1] > screen_np.shape[1]):
        print("[WARN] 템플릿 이미지가 소스보다 큼. 크기 조정 시작")
        # 최대 비율 계산 (80% 안전 계수)
        height_ratio = screen_np.shape[0] / template.shape[0] * 0.8
        width_ratio = screen_np.shape[1] / template.shape[1] * 0.8
        scale_factor = min(height_ratio, width_ratio)

        new_height = int(template.shape[0] * scale_factor)
        new_width = int(template.shape[1] * scale_factor)
        template = cv2.resize(template, (new_width, new_height))
        print(f"[INFO] 템플릿 이미지 리사이즈: ({new_width}, {new_height})")

    # 컬러 이미지는 CLAHE 대신 그대로 사용하거나, 필요하다면 컬러 전처리(예: YCrCb 변환) 코드를 추가
    return screen_np, template


def find_add_friend_icon_direct(region):
    """
    직접 '사람 추가' 아이콘을 찾는 함수 
    - 상단 우측에 위치한 '+' 모양의 아이콘을 찾음
    """
    timestamp = datetime.datetime.now().strftime('%Y%m%d%H%M%S')
    
    # 상단 우측 영역만 캡처
    screen_width = region[2]
    screen_height = region[3]
    
    # 상단 우측 20% 영역만 검색
    right_top_region = (
        region[0] + int(screen_width * 0.7),  # 우측 30% 시작
        region[1],  # 상단부터
        int(screen_width * 0.3),  # 우측 30% 넓이
        int(screen_height * 0.2)   # 상단 20% 높이
    )

    try:
        # 상단 우측 영역만 캡처해서 디버그 이미지 저장
        top_right = pyautogui.screenshot(region=right_top_region)
        debug_top_right_path = str(DEBUG_DIR / f"top_right_{timestamp}.png")
        top_right.save(debug_top_right_path)
        print(f"[DEBUG] 상단 우측 영역 캡처 저장: {debug_top_right_path}")

        # OpenCV로 변환
        top_right_np = np.array(top_right)
        top_right_gray = cv2.cvtColor(top_right_np, cv2.COLOR_BGR2GRAY)

        # 연산 이미지 생성 - 친구 추가 버튼은 밝은 배경에 어두운 아이콘일 확률이 높음
        # 이미지 이진화
        _, binary = cv2.threshold(top_right_gray, 127, 255, cv2.THRESH_BINARY)

        # 윤곽선 검출
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        # 디버그용 이미지 복사
        debug_image = top_right_np.copy()

        # 타겟 윤곽선과 중심점 찾기
        potential_icons = []

        for contour in contours:
            # 윤곽선 면적 계산
            area = cv2.contourArea(contour)

            # '+' 아이콘 후보 필터링 (크기에 따라 조절 필요)
            if 20 < area < 500:  # 적절한 크기의 아이콘 필터링
                x, y, w, h = cv2.boundingRect(contour)
                aspect_ratio = float(w) / h if h > 0 else 0

                # '+'는 가로세로 비율이 1에 가까움
                if 0.5 < aspect_ratio < 1.5:
                    # 중심점 계산
                    center_x = x + w // 2
                    center_y = y + h // 2
                    potential_icons.append((center_x, center_y, area, aspect_ratio))

                    # 후보 표시
                    cv2.rectangle(debug_image, (x, y), (x + w, y + h), (0, 255, 0), 2)
                    cv2.circle(debug_image, (center_x, center_y), 5, (0, 0, 255), -1)

        # 디버그 이미지 저장
        debug_contours_path = str(DEBUG_DIR / f"add_icon_candidates_{timestamp}.png")
        cv2.imwrite(debug_contours_path, debug_image)
        print(f"[DEBUG] 아이콘 후보 마킹 이미지 저장: {debug_contours_path}")

        # 후보가 있으면 가장 적합한 것 선택
        if potential_icons:
            # 상단 영역의 우측에 위치할 확률이 높음
            # 우측부터 정렬하고 가장 작은 것 선택 (작은 아이콘이 '+' 일 가능성 높음)
            potential_icons.sort(key=lambda x: (-x[0], x[2]))  # 우측 우선, 그 다음 작은 면적 우선

            # 가장 적합한 후보의 실제 화면 좌표 계산
            screen_x = right_top_region[0] + potential_icons[0][0]
            screen_y = right_top_region[1] + potential_icons[0][1]

            # 결과 디버그 이미지에 최종 선택 표시
            best_choice_img = debug_image.copy()
            cv2.circle(best_choice_img,
                       (potential_icons[0][0], potential_icons[0][1]),
                       10, (255, 0, 0), 3)
            best_choice_path = str(DEBUG_DIR / f"add_icon_selected_{timestamp}.png")
            cv2.imwrite(best_choice_path, best_choice_img)
            print(f"[DEBUG] 선택된 아이콘 이미지 저장: {best_choice_path}")

            # 좌표 반환
            print(f"[INFO] 친구 추가 아이콘 직접 찾기 성공: ({screen_x}, {screen_y})")
            return screen_x, screen_y
    except Exception as e:
        print(f"[ERROR] 친구 추가 아이콘 직접 찾기 실패: {e}")

    return None


def alt_add_friend_click(region):
    """
    친구 추가 아이콘을 직접 좌표로 클릭하는 대체 방법
    카카오톡 창 구조에 의존하며, 창 크기가 달라지면 작동하지 않을 수 있음
    """
    try:
        # 창 크기를 고려하여 상단 우측 영역의 친구 추가 버튼 좌표 계산
        window_width = region[2]
        window_height = region[3]

        # 우측 상단 고정 위치 비율 (상대 위치)
        # 대략 95% 가로, 5% 세로 위치에 아이콘이 있다고 가정
        rel_x = 0.95
        rel_y = 0.05

        # 절대 좌표 계산
        add_icon_x = region[0] + int(window_width * rel_x)
        add_icon_y = region[1] + int(window_height * rel_y)

        # 단순화: 오직 한 번만 클릭 (0, 0 오프셋)
        x = add_icon_x + 0
        y = add_icon_y + 0

        print(f"[DEBUG] 친구추가 아이콘 단일 좌표 클릭: ({x}, {y})")

        # 스크린샷으로 클릭 위치 표시 (디버깅용)
        screen = pyautogui.screenshot()
        draw = ImageDraw.Draw(screen)
        draw.ellipse((x-10, y-10, x+10, y+10), outline="red", width=2)
        timestamp = datetime.datetime.now().strftime('%Y%m%d%H%M%S')
        debug_path = str(DEBUG_DIR / f"click_target_{timestamp}.png")
        screen.save(debug_path)
        print(f"[DEBUG] 클릭 위치 마킹 저장: {debug_path}")

        # 단일 클릭 실행
        pyautogui.moveTo(x, y)
        time.sleep(0.2)
        pyautogui.click()
        time.sleep(1)

        print("[INFO] 대체 방식으로 클릭 완료")
        return True

    except Exception as e:
        print(f"[ERROR] 대체 클릭 방식 실패: {e}")
        return False


def find_button(region, button_type="yellow", search_area="bottom"):
    """
    통합 버튼 탐지 함수

    Parameters:
    - region: 검색할 화면 영역
    - button_type: "yellow" (노란 버튼) 또는 "gray" (회색 버튼)
    - search_area: "full" (전체 화면), "bottom" (하단 영역)

    Returns:
    - (x, y): 버튼 중앙 좌표 또는 None
    """
    print(f"[DEBUG] 버튼 탐지 시작: 타입={button_type}, 영역={search_area}")

    # 검색 영역 제한
    if search_area == "bottom":
        region = (
            region[0],
            region[1] + int(region[3] * 0.5),  # 하단 30%
            region[2],
            int(region[3] * 0.5)
        )

    # 스크린샷 캡처
    screen = pyautogui.screenshot(region=region)
    screen_np = np.array(screen)

    # HSV 변환
    hsv = cv2.cvtColor(screen_np, cv2.COLOR_RGB2HSV)

    # 버튼 색상 범위 설정
    if button_type == "yellow":
        lower_color = np.array([15, 60, 120])
        upper_color = np.array([45, 255, 255])
    elif button_type == "gray":
        lower_color = np.array([0, 0, 80])
        upper_color = np.array([180, 30, 200])
    else:
        raise ValueError("Invalid button_type. Use 'yellow' or 'gray'.")

    # 색상 마스크 생성
    mask = cv2.inRange(hsv, lower_color, upper_color)

    # 윤곽선 찾기
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    # 가장 큰 윤곽선 찾기
    for contour in sorted(contours, key=cv2.contourArea, reverse=True):
        x, y, w, h = cv2.boundingRect(contour)
        area = cv2.contourArea(contour)

        # 버튼 크기와 위치 필터링
        if area > 2000 and w > 50 and 2 < w/h < 10:
            print(f"[DEBUG] 버튼 발견: x={x}, y={y}, w={w}, h={h}, 면적={area}")

            # 버튼 중앙 좌표 계산
            center_x = region[0] + x + w // 2
            center_y = region[1] + y + h // 2
            return center_x, center_y

    print("[DEBUG] 버튼을 찾지 못함")
    return None


def wait_and_click(image_path, confidence=0.5, timeout=10):
    print(f"[INFO] 이미지 찾는 중: {image_path}")

    # 이미지 파일 존재 여부 확인
    if not os.path.exists(image_path):
        print(f"[ERROR] 이미지 파일이 존재하지 않음: {image_path}")
        raise Exception(f"이미지 파일이 존재하지 않음: {image_path}")

    try:
        region = get_kakaotalk_window_region()
        print(f"[DEBUG] 검색 영역: {region}")
        timestamp = datetime.datetime.now().strftime('%Y%m%d%H%M%S')

        # 특별히 '친구 추가' 아이콘을 찾는 경우 직접 찾기 방법 시도
        if "add_icon.png" in image_path:
            print("[DEBUG] 친구 추가 아이콘 직접 찾기 시도")

            # 방법 1: 직접 찾기
            icon_position = find_add_friend_icon_direct(region)
            if icon_position:
                # 클릭
                center_x, center_y = icon_position
                pyautogui.moveTo(center_x, center_y)
                time.sleep(0.2)
                pyautogui.click()
                print(f"[INFO] 직접 찾기 방식으로 클릭 성공: ({center_x}, {center_y})")
                return True

            # 방법 2: 고정 좌표 기반 우측 상단 클릭 시도
            print("[DEBUG] 대체 방식으로 친구 추가 버튼 클릭 시도")
            if alt_add_friend_click(region):
                print("[INFO] 대체 방식으로 클릭 성공")
                return True

        # 직접 찾기 실패하면 OpenCV 템플릿 매칭으로 시도
        start = time.time()
        while time.time() - start < timeout:
            print("[DEBUG] OpenCV로 이미지 매칭 시도")
            try:
                # 이미지 전처리
                screen, template = preprocess_image(image_path, region)

                if template is None:
                    print("[ERROR] 템플릿 이미지 로드 실패")
                    time.sleep(0.5)
                    continue

                # 그레이스케일로 변환 (추가)
                screen_gray = cv2.cvtColor(screen, cv2.COLOR_RGB2GRAY)
                template_gray = cv2.cvtColor(template, cv2.COLOR_BGR2GRAY)

                # 템플릿이 소스보다 크면 실패
                if template_gray.shape[0] > screen_gray.shape[0] or template_gray.shape[1] > screen_gray.shape[1]:
                    print("[ERROR] 리사이즈 후에도 템플릿이 여전히 소스보다 큽니다")
                    time.sleep(0.5)
                    continue

                # 템플릿 매칭 수행 (그레이스케일 이미지 사용)
                result = cv2.matchTemplate(screen_gray, template_gray, cv2.TM_CCOEFF_NORMED)
                min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(result)
                print(f"[DEBUG] 매칭 점수: {max_val}")

                if max_val >= confidence:
                    # 클릭 위치 계산 - 수정된 부분: 3차원 배열 처리
                    x, y = max_loc
                    # 수정: 템플릿 크기 추출 방식 변경
                    w, h = template_gray.shape[1], template_gray.shape[0]  # 그레이스케일 이미지 사용
                    center_x, center_y = x + w // 2 + region[0], y + h // 2 + region[1]

                    # 클릭 전 디버그 이미지 저장
                    marked = screen_gray.copy()
                    marked = cv2.cvtColor(marked, cv2.COLOR_GRAY2BGR)
                    cv2.rectangle(marked, (x, y), (x + w, y + h), (0, 0, 255), 2)
                    debug_marked_path = str(DEBUG_DIR / f"marked_{timestamp}.png")
                    cv2.imwrite(debug_marked_path, marked)
                    print(f"[DEBUG] 마킹된 이미지 저장: {debug_marked_path}")

                    # 클릭
                    pyautogui.moveTo(center_x, center_y)
                    time.sleep(0.2)
                    pyautogui.click()
                    print(f"[INFO] 클릭 성공: {image_path} @ ({center_x}, {center_y})")
                    return True
                else:
                    print(f"[DEBUG] 매칭 실패: confidence={max_val}")
            except Exception as e:
                print(f"[ERROR] OpenCV 이미지 매칭 중 오류: {e}")

            time.sleep(0.5)

        # 이미지를 찾지 못한 경우, 캡처 저장
        try:
            failure_path = str(DEBUG_DIR / f"fail_capture_{timestamp}.png")
            pyautogui.screenshot(failure_path, region=region)
            print(f"[DEBUG] 이미지 인식 실패 - 캡처 저장: {failure_path}")
        except Exception as e:
            print(f"[ERROR] 실패 캡처 저장 오류: {e}")

        raise Exception(f"[ERROR] 클릭 실패 - 이미지 못 찾음: {image_path}")

    except Exception as e:
        print(f"[ERROR] wait_and_click 실패: {str(e)}")
        raise


def navigate_to_friends_tab():
    """
    카카오톡 친구 탭으로 이동하는 함수
    """
    print("[DEBUG] 친구 탭으로 이동 시도")

    # 키를 개별적으로 누르기 (방법 2)
    print("[DEBUG] 키 개별 입력 방식으로 Command+1 실행")
    pyautogui.keyDown('command')
    time.sleep(0.2)
    pyautogui.press('1')
    time.sleep(0.2)
    pyautogui.keyUp('command')
    time.sleep(1)

    print("[DEBUG] 친구 탭 이동 완료")


def add_friend(username, phone):
    print("[INFO] 카카오톡 실행")
    os.system("open -a KakaoTalk")
    time.sleep(1)

    # 디버그 폴더 초기화
    clear_debug_dir()

    # 카카오톡 창 영역 가져오기
    focus_kakaotalk()

    # 친구 탭으로 이동
    navigate_to_friends_tab()
    time.sleep(0.2)

    try:
        # 사람+ 아이콘 클릭
        print("[DEBUG] 친구 추가 아이콘 클릭 시도...")
        wait_and_click(ICON_ADD)

        # 친구 이름 입력
        time.sleep(0.5)
        print(f"[DEBUG] 친구 이름 입력: {username}")
        pyperclip.copy(username)
        time.sleep(0.1)
        pyautogui.hotkey('command', 'v')
        time.sleep(0.2)

        # 전화번호 필드로 이동
        print("[DEBUG] 전화번호 입력 필드로 탭 이동")
        pyautogui.press("tab", presses=3, interval=0.1)
        time.sleep(0.2)

        # 전화번호 입력
        print(f"[DEBUG] 전화번호 입력: {phone}")
        pyperclip.copy(phone)
        pyautogui.keyDown('command')
        time.sleep(0.2)
        pyautogui.press('v')
        time.sleep(0.2)
        pyautogui.keyUp('command')

        # 버튼 클릭 시도: 노란색 버튼 탐지
        print("[DEBUG] 노란색 버튼 탐지 및 클릭 시도")
        region = get_kakaotalk_window_region()
        button_pos = find_button(region, button_type="yellow", search_area="bottom")

        if button_pos:
            x, y = button_pos
            pyautogui.moveTo(x, y, duration=0)
            pyautogui.click()
            time.sleep(1.5)

            # 메시지 박스가 뜨는 영역만 캡처 (예: 창 하단 120픽셀)
            msg_region = (
                region[0] + 10,
                region[1] + region[3] - 300,   # 더 위에서부터 시작 (기존 -200 → -300)
                region[2] - 20,
                220                            # 높이도 더 크게 (기존 120 → 220)
            )
            result_img = pyautogui.screenshot(region=msg_region)
            result_img.save("debugs-screens/ocr_msg_area.png")  # 디버깅용

            result_text = pytesseract.image_to_string(result_img, lang="kor+eng")
            print(f"[DEBUG] OCR 결과: {result_text}")

            if "친구 등록에 성공했습니다" in result_text:
                print(f"[✅ 완료] 친구 추가 성공: {username} / {phone}")
                return {"username": username, "phone": phone, "status": "success"}
            elif "이미 등록된 친구입니다" in result_text:
                print(f"[❌ 실패] 친구 추가 실패(이미 등록): {username} / {phone}")
                return {"username": username, "phone": phone, "status": "already_registered"}
            elif "입력하신 번호를 친구로 추가할 수 없습니다" in result_text:
                print(f"[❌ 실패] 친구 추가 실패(추가 불가): {username} / {phone}")
                return {"username": username, "phone": phone, "status": "not_allowed"}
            else:
                print(f"[❌ 실패] 친구 추가 실패(알 수 없음): {username} / {phone}")
                return {"username": username, "phone": phone, "status": "fail", "reason": "알 수 없음"}

        print("[❌ 실패] 버튼을 찾지 못했습니다.")
        return {"username": username, "phone": phone, "status": "fail", "reason": "버튼 미탐지"}

    except Exception as e:
        print(f"[❌ 실패] 친구 추가 실패: {username} - {str(e)}")
        raise


def add_friends_via_kakao(friends_data):
    """
    여러 친구를 카카오톡에 한 번에 추가하는 함수

    Args:
        friends_data (list): 추가할 친구 정보 리스트
            [{"username": "친구이름", "phone": "전화번호"}, ...]

    Returns:
        list: 각 친구 추가 결과 리스트
    """
    # 디버그 폴더 초기화
    clear_debug_dir()

    results = []

    for friend in friends_data:
        try:
            add_friend(friend['username'], friend['phone'])
            results.append({
                "username": friend['username'],
                "status": "success"
            })
        except Exception as e:
            results.append({
                "username": friend['username'],
                "status": "fail",
                "reason": str(e)
            })

    return results

def capture_kakao_window(output_path):
    """
    카카오톡 창을 클릭 없이 자동으로 캡처하는 함수
    """
    try:
        # 출력 디렉토리 확인 및 생성
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        # 카카오톡 앱 강제 활성화
        focus_kakaotalk()
        time.sleep(0.5)
        
        # 전체 프로세스와 캡처를 하나의 AppleScript로 처리
        applescript = f'''
        osascript -e '
        tell application "KakaoTalk" to activate
        delay 0.5
        
        tell application "System Events"
            tell process "KakaoTalk"
                set frontmost to true
                # 첫 번째 창 캡처 (가장 최근에 열린 창)
                set win to a reference to (first window whose role is "AXWindow" and subrole is "AXStandardWindow")
                set winPos to position of win
                set winSize to size of win
                
                # 창 위치와 크기 반환
                set result to {{item 1 of winPos, item 2 of winPos, item 1 of winSize, item 2 of winSize}}
                return result
            end tell
        end tell
        '
        '''
        
        result = subprocess.run(applescript, shell=True, text=True, capture_output=True)
        window_info = result.stdout.strip()
        
        # 창 정보 파싱
        if window_info:
            try:
                coords = [int(x) for x in window_info.replace("{", "").replace("}", "").split(",")]
                if len(coords) == 4:
                    x, y, width, height = coords
                    # screencapture 명령으로 특정 영역 캡처
                    subprocess.run(['screencapture', '-R', f"{x},{y},{width},{height}", '-x', output_path], check=True)
                    print(f"[INFO] 카카오톡 창 자동 캡처 완료: {output_path}")
                    return True
            except Exception as parse_error:
                print(f"[WARN] 창 정보 파싱 실패: {parse_error}")
        
        # 대체 방법: 현재 활성 창 캡처
        print("[WARN] 창 좌표를 가져오지 못함, 활성 창 캡처 시도...")
        subprocess.run(['screencapture', '-W', '-x', output_path], check=True)
        print(f"[INFO] 활성 창 캡처 완료: {output_path}")
        
        # 파일이 실제로 생성되었는지 확인
        if os.path.exists(output_path):
            print(f"[INFO] 파일 저장 확인: {output_path} ({os.path.getsize(output_path)} bytes)")
            return True
        else:
            print(f"[ERROR] 파일이 생성되지 않음: {output_path}")
            return False
            
    except Exception as e:
        print(f"[ERROR] 창 캡처 실패: {e}")
        return False
        
def check_message_status(username, timestamp):
    """
    메시지 전송 후 상태를 확인하는 함수
    포커스된 채팅창을 캡처하고 OCR로 분석
    """
    # 활성 창(채팅창) 캡처
    first_msg_path = f"debugs-screens/first_msg_{username}_{timestamp}.png"
    if not capture_kakao_window(first_msg_path):
        return False, "채팅창 캡처 실패"
    
    print(f"[DEBUG] 첫 메시지 전송 후 캡처: {first_msg_path}")
    
    # 캡처된 이미지 불러오기
    try:
        img = cv2.imread(first_msg_path)
        if img is None:
            raise Exception("이미지 로딩 실패")
        
        # 이미지의 하단 부분만 크롭 (하단 20%)
        height, width = img.shape[:2]
        bottom_height = int(height * 0.2)
        bottom_img = img[height - bottom_height:height, :]
        
        # 하단 부분 이미지 저장
        bottom_capture_path = f"debugs-screens/bottom_area_{username}_{timestamp}.png"
        cv2.imwrite(bottom_capture_path, bottom_img)
        
        # OCR로 텍스트 추출
        ocr_text = pytesseract.image_to_string(bottom_img, lang="kor+eng")
        print(f"[DEBUG] 첫 메시지 후 OCR 결과: {ocr_text}")
        
        # 오류 메시지 체크
        error_patterns = [
            "전송 실패", "메시지를 보낼 수 없습니다",
            "차단", "수신 거부", "오류가 발생",
            "메시지 전송에 실패"
        ]
        
        for pattern in error_patterns:
            if pattern in ocr_text:
                error_msg = f"메시지 전송 오류: {pattern}"
                print(f"[ERROR] {error_msg}")
                return False, error_msg
        
        # 성공 패턴 체크
        success_patterns = ["읽음", "1", "전송됨"]
        for pattern in success_patterns:
            if pattern in ocr_text:
                print(f"[INFO] 메시지 전송 성공 확인: {pattern} 감지됨")
                return True, ""
        
        return True, ""  # 오류 패턴이 없으면 일단 성공으로 간주
        
    except Exception as e:
        print(f"[ERROR] 메시지 상태 확인 중 오류: {e}")
        return False, str(e)


def send_messages_via_kakao(message_groups):
    """
    카카오톡에서 친구를 찾아 여러 메시지를 순차적으로 발송하는 함수
    첫 메시지 전송 후 상태 확인하고 성공 시에만 나머지 메시지 전송
    """
    clear_debug_dir()
    results = []
    region = get_kakaotalk_window_region()
    focus_kakaotalk()
    time.sleep(1)
    
    for group in message_groups:
        username = group["username"]
        messages = group["messages"]
        success = True
        error_msg = ""
        first_message_sent = False
        
        try:
            # 1. 친구탭 이동
            pyautogui.keyDown('command')
            time.sleep(0.2)
            pyautogui.press('1')
            time.sleep(0.2)
            pyautogui.keyUp('command')
            
            # 2. 검색창 활성화
            pyautogui.keyDown('command')
            time.sleep(0.2)
            pyautogui.press('f')
            time.sleep(0.2)
            pyautogui.keyUp('command')
            
            # 3. 친구명 복사 및 붙여넣기
            pyperclip.copy(username)
            pyautogui.keyDown('command')
            time.sleep(0.2)
            pyautogui.press('v')
            time.sleep(0.2)
            pyautogui.keyUp('command')
            
            pyautogui.press('down', presses=2, interval=0.1)
            time.sleep(0.2)
            pyautogui.press('enter')
            time.sleep(0.3)  # 친구 선택 후 대화창 열릴 시간 대기
            
            timestamp = datetime.datetime.now().strftime('%Y%m%d%H%M%S')
            
            # 메시지가 없으면 건너뛰기
            if not messages:
                print(f"[WARN] {username}에게 보낼 메시지가 없습니다.")
                results.append({
                    "username": username,
                    "status": "skip",
                    "reason": "메시지 없음"
                })
                continue
            
            # 첫 메시지 전송
            first_msg = messages[0]
            msg_type = first_msg["type"]
            content = first_msg["content"]
            
            if msg_type == "text":
                # 텍스트 메시지 입력 및 전송
                print(f"[INFO] 첫 텍스트 메시지 전송: {content[:20]}...")
                pyperclip.copy(content)
                pyautogui.keyDown('command')
                time.sleep(0.4)
                pyautogui.press('v')
                time.sleep(0.4)
                pyautogui.keyUp('command')
                time.sleep(0.4)
                pyautogui.press('enter')
                
            elif msg_type == "image":
                # 이미지 메시지 전송
                print(f"[INFO] 첫 이미지 메시지 전송: {content}")
                if not os.path.exists(content):
                    print(f"[ERROR] 이미지 파일이 존재하지 않음: {content}")
                    raise FileNotFoundError(f"이미지 파일이 존재하지 않음: {content}")
                
                # 이미지 전송 로직
                abs_path = os.path.abspath(content)
                directory = os.path.dirname(abs_path)
                filename = os.path.basename(abs_path)
                
                # AppleScript로 파일 복사 및 붙여넣기
                applescript = f'''
                tell application "Finder"
                    set filePath to POSIX file "{abs_path}"
                    select filePath
                    activate
                    delay 1
                end tell

                # 실제 클릭 이벤트 추가
                tell application "System Events"
                    # 마우스 클릭으로 포커스 강제 설정
                    tell process "Finder"
                        # 중괄호 문법 수정
                        set windowBounds to bounds of front window
                        click at {{(item 1 of windowBounds + item 3 of windowBounds) / 2, (item 2 of windowBounds + item 4 of windowBounds) / 2}}
                        delay 0.5
                    end tell
                    
                    # 편집 메뉴에서 복사 선택
                    click menu item "복사" of menu "편집" of menu bar item "편집" of menu bar 1 of application process "Finder"
                    delay 1.5
                end tell

                # 카카오톡으로 전환 (확실히 활성화되도록 개선)
                tell application "KakaoTalk" to activate
                delay 1.5  # 전환 대기 시간 증가

                # 카카오톡 창 활성화 확인 및 붙여넣기
                tell application "System Events"
                    # 카카오톡 프로세스가 최상위에 있는지 확인
                    tell process "KakaoTalk"
                        set frontmost to true
                        delay 0.5
                    end tell
                    
                    # 붙여넣기 확실히 하기
                    keystroke "v" using {{command down}}  # 중괄호 이스케이프 처리
                    delay 1.5

                    # 한 번 더 시도 (보험)
                    keystroke "v" using {{command down}}  # 중괄호 이스케이프 처리
                    delay 1
                    
                    # 전송
                    keystroke return
                    delay 1
                end tell
                '
                '''
                print("[DEBUG] 파인더에서 파일 복사 및 붙여넣기 실행")
                subprocess.run(applescript, shell=True, check=True)
                
            first_message_sent = True
            time.sleep(1.5)  # 메시지 전송 후 알림이 표시될 시간 충분히 대기
            
            # 메시지 전송 후 상태 확인을 위해 캡처
            print("[INFO] 첫 메시지 전송 완료, 상태 체크 중...")
            success, check_error = check_message_status(username, timestamp)
            
            if not success:
                error_msg = check_error
                print(f"[ERROR] 첫 메시지 전송 실패: {error_msg}")
                results.append({
                    "username": username,
                    "status": "fail",
                    "reason": error_msg
                })
                # 채팅방 나가기
                pyautogui.press('esc')
                time.sleep(0.5)
                continue  # 다음 친구로 넘어감
            
            # 첫 메시지 전송 성공! 나머지 메시지 전송
            print("[INFO] 첫 메시지 전송 성공, 나머지 메시지 전송 시작")
            
            # 1번째 이후의 메시지 전송
            for idx, msg in enumerate(messages[1:], 1):
                msg_type = msg["type"]
                content = msg["content"]
                
                if msg_type == "text":
                    # 텍스트 메시지 입력 및 전송
                    print(f"[INFO] 텍스트 메시지 #{idx+1} 전송: {content[:20]}...")
                    pyperclip.copy(content)
                    pyautogui.keyDown('command')
                    time.sleep(0.2)
                    pyautogui.press('v')
                    time.sleep(0.2)
                    pyautogui.keyUp('command')
                    time.sleep(0.2)
                    pyautogui.press('enter')
                    time.sleep(0.5)
                    
                elif msg_type == "image":
                    # 이미지 전송: 파인더에서 이미지 선택 후 카카오톡에 붙여넣기
                    print(f"[INFO] 이미지 메시지 #{idx+1} 전송: {content}")
                    
                    # 파일 존재 확인
                    if not os.path.exists(content):
                        print(f"[ERROR] 이미지 파일이 존재하지 않음: {content}")
                        continue  # 이 이미지는 건너뛰고 다음 메시지로
                    
                    # 절대 경로 변환
                    abs_path = os.path.abspath(content)
                    directory = os.path.dirname(abs_path)
                    filename = os.path.basename(abs_path)  # 모든 경로에서 filename 변수 초기화

                    # 이미지 전송 시도
                    try:
                        # 메뉴 항목 대신 키보드 단축키 사용
                        applescript = f'''
                        tell application "Finder"
                            set filePath to POSIX file "{abs_path}"
                            select filePath
                            activate
                            delay 1
                        end tell

                        # 실제 클릭 이벤트 추가
                        tell application "System Events"
                            # 마우스 클릭으로 포커스 강제 설정
                            tell process "Finder"
                                # 중괄호 문법 수정
                                set windowBounds to bounds of front window
                                click at {{(item 1 of windowBounds + item 3 of windowBounds) / 2, (item 2 of windowBounds + item 4 of windowBounds) / 2}}
                                delay 0.5
                            end tell
                            
                            # 편집 메뉴에서 복사 선택
                            click menu item "복사" of menu "편집" of menu bar item "편집" of menu bar 1 of application process "Finder"
                            delay 1.5
                        end tell

                        # 카카오톡으로 전환 (확실히 활성화되도록 개선)
                        tell application "KakaoTalk" to activate
                        delay 1.5  # 전환 대기 시간 증가

                        # 카카오톡 창 활성화 확인 및 붙여넣기
                        tell application "System Events"
                            # 카카오톡 프로세스가 최상위에 있는지 확인
                            tell process "KakaoTalk"
                                set frontmost to true
                                delay 0.5
                            end tell
                            
                            # 붙여넣기 확실히 하기
                            keystroke "v" using {{command down}}  # 중괄호 이스케이프 처리
                            delay 1.5

                            # 한 번 더 시도 (보험)
                            keystroke "v" using {{command down}}  # 중괄호 이스케이프 처리
                            delay 1
                            
                            # 전송
                            keystroke return
                            delay 1
                        end tell
                        '
                        '''
                        
                        print("[DEBUG] 파인더에서 파일 복사 실행")
                        subprocess.run(applescript, shell=True, check=True)
                        time.sleep(1.5)
                        
                    except Exception as img_error:
                        print(f"[ERROR] 이미지 전송 실패: {img_error}")
                        
                        # 대체 방법: 직접 이미지 복사
                        try:
                            # filename 변수가 이미 위에서 정의됨
                            print(f"[DEBUG] 대체 방법으로 이미지 전송 시도: {filename}")
                            
                            # pbcopy 명령어로 파일 자체를 클립보드에 복사
                            subprocess.run(
                                f"osascript -e 'set the clipboard to (read (POSIX file \"{abs_path}\") as TIFF picture)'", 
                                shell=True, check=True
                            )
                            time.sleep(0.5)
                            
                            # 카카오톡으로 전환
                            focus_kakaotalk()
                            time.sleep(0.8)
                            
                            # 붙여넣기
                            pyautogui.keyDown('command')
                            time.sleep(0.2)
                            pyautogui.press('v')
                            time.sleep(0.2)
                            pyautogui.keyUp('command')
                            time.sleep(1)
                            
                            # 전송
                            pyautogui.press('enter')
                            time.sleep(1)
                            
                            print(f"[INFO] 대체 방법으로 이미지 전송 완료: {filename}")
                            
                        except Exception as alt_error:
                            print(f"[ERROR] 모든 이미지 전송 방법 실패: {alt_error}")
                            # 최후의 방법: 파일 경로만 전송
                            pyperclip.copy(f"이미지 전송 실패: {abs_path}")
                            pyautogui.keyDown('command')
                            time.sleep(0.2)
                            pyautogui.press('v') 
                            time.sleep(0.2)
                            pyautogui.keyUp('command')
                            time.sleep(0.5)
                            pyautogui.press('enter')
        
            # 모든 메시지 전송 완료
            print(f"[SUCCESS] {username}에게 모든 메시지 전송 완료")
            results.append({
                "username": username,
                "status": "success"
            })
            
            # 채팅방 나가기
            pyautogui.press('esc')
            time.sleep(0.5)
                
        except Exception as e:
            print(f"[ERROR] {username}에게 메시지 전송 중 오류: {e}")
            results.append({
                "username": username,
                "status": "fail",
                "reason": str(e)
            })
            # 예외 발생 시에도 채팅방 나가기 시도
            try:
                pyautogui.press('esc')
                time.sleep(0.5)
            except Exception as e:  # 구체적인 예외 타입 지정
                print(f"[WARN] 채팅방 나가기 실패: {e}")
                pass
                
    return results