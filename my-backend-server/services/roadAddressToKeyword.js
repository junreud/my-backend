/**
 * 주소 문자열을 받아서 규칙에 따라 키워드 배열을 반환한다.
 * 
 * 1) 맨 앞(광역시/도)은 모두 스킵.
 *    - 단, 인천/인천광역시는 자체 키워드는 추가하지 않지만 "동"과 결합시 prefix로 사용.
 * 2) 두 번째 토큰이 "xx구", "xx군", "xx시"이면 다음 처리:
 *    - 만약 앞 글자가 1글자이면(예: "중구", "서구") -> 그대로만 저장 (중구)
 *    - 만약 앞 글자가 2글자 이상이면(예: "동대문구") -> '동대문구' 와 '동대문' 둘 다 저장 
 *      (시·군도 같은 방식. 예: "논산시" -> "논산")
 *    - "군", "구", "시" 등 조사는 제거한 형태도 함께 사용(단, 앞 글자 길이에 따라 달라짐)
 * 3) 이후 나오는 "길", "지번" 등은 스킵(포함하지 않음).
 *    - 예: "명동8길" -> "길" 자체는 무시.
 *    - "번길", "대로", "로" 등은 사용자 규칙에 맞춰 부분 제거 가능(예시 코드 참조).
 * 4) 괄호 안에 있는 주소(예: (명동2가)):
 *    - "동"이나 "가"로 끝나면 숫자 뒤는 제거: "명동2가" -> "명동"
 *    - "주안동" -> "주안", "주안동"
 *    - "리"면 통째로만 저장: "하길리" -> "하길리"
 * 5) "동"이나 "가" 같은 소단위가 추출되면, 두 번째 토큰(구/군/시 제거 형태)과 합친 키워드도 생성
 *    - 예: 두 번째가 '논산'이고 괄호 안에서 '취암동' 얻었다면 -> '논산취암동', '논산취암'
 *    - 인천/인천광역시는 스킵했던 1단계를 prefix로 붙일 수도 있음. 예: "인천주안", "인천주안동"
 */

function extractAddressKeywords(address) {
    // 1. 앞쪽 시/도 스킵(서울/경기/인천/대전/충남/전남 등)
    //    - 단, 인천/인천광역시는 prefix용으로만 기억해둔다.
    const skipRegions = ['서울특별시','서울','충남','경기','전남','대전광역시','대전'];
    const incheonVariants = ['인천','인천광역시']; // 인천 prefix 전용
    let prefixForDong = null;   // 인천의 경우만 여기 저장해뒀다가 동 단위 결합에 활용
    let remainingTokens = [];
    
    // 주소를 공백 기준으로 잘라낸다
    let tokens = address.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];
    
    // 첫 토큰(시/도 단위) 확인
    const firstToken = tokens[0].replace(/[^\p{L}\d]/gu, ''); 
    // (특수문자 제거, 예: '충남,'에 쉼표 있으면 제거)
    
    let firstTokenKeep = null; // 첫 번째 토큰(시/도)을 기억해두기
    
    // 도시 이름 처리 함수: 특별시, 광역시 등 접미사 제거 후 앞 두 글자만 사용
    const normalizeCityName = (cityName) => {
      // 특별시, 광역시, 특별자치도, 특별자치시 등의 접미사 제거
      const simpleName = cityName.replace(/(특별시|광역시|특별자치도|특별자치시|자치도|시)$/, '');
      // 첫 두 글자만 반환
      return simpleName.substring(0, 2);
    };
    
    if (incheonVariants.includes(firstToken)) {
      // 인천의 경우 -> 토큰 자체는 추가 X, prefixForDong에 '인천'만 저장
      prefixForDong = '인천';
      firstTokenKeep = '인천'; // 인천 저장
      // 다음 토큰부터 처리
      remainingTokens = tokens.slice(1);
    } else if (skipRegions.includes(firstToken)) {
      // 그 외 스킵 목록
      // 도시 이름 정규화: 접미사 제거 후 앞 두 글자만 사용
      firstTokenKeep = normalizeCityName(firstToken); // 서울특별시 -> 서울, 대구광역시 -> 대구
      remainingTokens = tokens.slice(1);
    } else {
      // 첫 토큰이 스킵 목록에 없으면 정규화 후 저장
      if (/(특별시|광역시|특별자치도|특별자치시|자치도)/.test(firstToken)) {
        firstTokenKeep = normalizeCityName(firstToken);
        remainingTokens = tokens.slice(1);
      } else {
        // 그 외 경우는 그대로 유지
        remainingTokens = tokens;
      }
    }
    
    // 2. 두 번째 토큰(구/군/시) 처리
    //    - 예: "중구" -> '중구'만,
    //         "동대문구" -> '동대문구', '동대문'
    let keywords = [];
    let secondLevelName = null; // 구/군/시에서 조사 제거한 형태 저장
    if (remainingTokens.length > 0) {
      let secondToken = remainingTokens[0].replace(/[^\p{L}\d]/gu, '');
      
      // 'xxxx구', 'xxxx군', 'xxxx시' 추출
      const match = secondToken.match(/^(.*?)([구군시])$/);
      if (match) {
        const main = match[1]; // 예: '중', '동대문'
        const suffix = match[2]; // '구' or '군' or '시'
        
        // 외자 구 리스트
        const shortDistricts = ['중', '서', '동', '남', '북'];
        
        if (main.length === 1 && shortDistricts.includes(main)) {
          // 앞 글자가 외자이고, 중구/서구/동구/남구/북구 중 하나인 경우
          // 단독으로는 키워드에 추가하지 않고 도시+구 형태만 사용
          
          // 시/도 + 구 조합 (예: "대구 중구", "부산 서구")
          if (firstTokenKeep) {
            keywords.push(`${firstTokenKeep} ${secondToken}`);
          } else {
            // 도시 이름 없으면 구 이름만 추가
            keywords.push(secondToken);
          }
          
          // 조사 제거 형태는 별도로 없음
          secondLevelName = main;       // '중' 저장(아래 동결합 시 쓸 수도 있으니)
        } else if (main.length === 1) {
          // 외자이지만 중/서/동/남/북 이외의 군/시인 경우 기존 로직
          keywords.push(secondToken);
          
          // 외자 구가 아니므로 시/도 + 구/군 조합 제거
          secondLevelName = main;
        } else {
          // 2글자 이상 -> 원본 + 조사제거 둘 다
          // 예) secondToken = '동대문구'
          keywords.push(secondToken);  // => '동대문구'
          
          // 외자 구가 아니므로 시/도 + 구/군 조합 제거
          
          const removed = main;        // => '동대문'
          keywords.push(removed);
          secondLevelName = removed;   // 동 결합 시 '동대문'으로 붙일 수 있음
        }
        
        // 두 번째 토큰을 소진하고, 나머지 주소는 remainingTokens[1..] 처리
        remainingTokens = remainingTokens.slice(1);
      } else {
        // 구/군/시가 없는 형태
        // 두 번째 토큰 전체가 바로 실제 도로명이거나 동/면/읍일 수도 있음
        secondLevelName = null; 
      }
    }
    
    // 3. 남은 토큰들을 순회하면서 키워드 추출
    //    - '길'은 무조건 스킵, '번길' '대로' '로' 등은 예시에 따라 일부만 추출 예시
    //    - 괄호 안 내용 파싱
    for (let i = 0; i < remainingTokens.length; i++) {
      let token = remainingTokens[i];
      
      // 괄호 안 패턴부터 먼저 확인
      // 예: "1,2층(명동2가)" -> '명동2가' 만 추출
      //     "320 (하길리)" -> '하길리'
      // 여러 괄호가 있을 수 있으니, 정규식으로 모두 뽑되, 중첩은 가정 X
      let parenthesisMatches = token.match(/\(([^)]+)\)/g);
      if (parenthesisMatches) {
        parenthesisMatches.forEach((matchStr) => {
          // 예: matchStr => "(명동2가)"
          let inner = matchStr.replace(/[\(\)]/g, ''); // 명동2가
          
          // 콤마로 구분된 여러 항목 각각 처리 (예: "주안동, 탑클래시아")
          let innerItems = inner.split(/\s*,\s*/);
          for (let item of innerItems) {
            // 숫자만으로 구성된 항목은 무시 (예: 건물 번호)
            if (/^\d+$/.test(item)) continue;
            
            let extracted = parseSubLocation(item, {
              prefixForDong,
              secondLevelName
            });
            keywords.push(...extracted);
          }
        });
        
        // 괄호 자체를 제거한 원본 토큰에서 주소 단위가 남는다면 그것도 처리
        token = token.replace(/\([^)]*\)/g, '').trim();
        if (!token) continue; // 괄호 빼고 아무것도 없다면 스킵
      }
      
      // '길'은 스킵 / '지번' 스킵 / 숫자+호도 스킵
      // 사용 예시 때문에 "번길", "대로", "로" 등은 적절히 잘라내거나 그대로 둘 수 있다.
      // 여기서는 사용자가 "길"은 무조건 스킵이라 했으므로
      // "XXX길", "XXX로", "XXX번길" 등 패턴 처리 예시:
      if (/(길)$/.test(token)) {
        // 예: 명동8길 -> 전체 스킵
        continue;
      }
      
      // 예: 중앙로398번길 -> "중앙로"만 뽑기 (규칙: 숫자+번길 삭제)
      let matchRoad = token.match(/^(.*?(?:로|대로|길))([\d\s]+번?(?:로|대로|길)?)?/);
      if (matchRoad) {
        // 예: 그룹1: "중앙로", 그룹2: "398번길" (있을 수도 있고 없을 수도 있음)
        if (matchRoad[1]) {
          // "중앙로", "인주대로", "상신하길로" 등
          keywords.push(matchRoad[1]);
        }
        // 혹시 번길 뒤에 다른 텍스트가 또 있다면 제거
        continue;
      }
      
    if (/^\d+$/.test(token) || // 숫자만으로 구성
        /\d+[\-\.]\d+/.test(token) || // 8-11, 103.104 같은 형태
        /\d+호$/.test(token) || // 숫자로 시작하고 '호'로 끝나는 경우
        /\d+층/.test(token)) {  // 층수 표시
        continue;
    }
      
      // 나머지는 '동', '가', '리' 등을 포함할 수 있음 -> parseSubLocation 처리
      // 예: "인계동" -> ["인계", "인계동"] + secondLevelName 결합
      // 예: "주안동" -> ["주안", "주안동"] + "인천주안", "인천주안동"
      // 예: "하길리" -> ["하길리"] (리는 분리 안 함)
      let subKeywords = parseSubLocation(token, {
        prefixForDong,
        secondLevelName
      });
      keywords.push(...subKeywords);
    }
    
    // 중복 제거
    let unique = Array.from(new Set(keywords));
    return unique.filter(Boolean);
  }
  
  /**
   * '동', '가'로 끝나는지, 혹은 '리'인지에 따라 분리/결합 규칙을 적용하는 헬퍼 함수
   * @param {string} token 예) '명동2가', '주안동', '하길리', '인계동'
   * @param {{ prefixForDong: string|null, secondLevelName: string|null }} options 
   * @returns {string[]} 
   */
  function parseSubLocation(token, options) {
    let { prefixForDong, secondLevelName } = options;
    
    // 예) '명동2가' => '명동'
    //     '주안동' => '주안', '주안동'
    //     '하길리' => '하길리' (리 분리 안 함)
    //     '매산로1가' -> '매산로'
    
    // 괄호 내 숫자 제거: 명동2가 -> 정규식으로 '(\D+)\d*(가|동)$' 식으로 파싱
    // 여기서는 단순히, '가'나 '동' 앞에 있는 숫자 제거
    let removedNum = token.replace(/(\d+)(?=(가|동)$)/, '');
    
    // '동' 또는 '가'로 끝나는지 확인
    if (/(동|가)$/.test(removedNum)) {
      // 예: "주안동", "명동"
      let base = removedNum.replace(/(동|가)$/, ''); // '주안'
      let full = removedNum;                         // '주안동'
      
      let result = [base, full];
      
      // 두 번째 주소(시,구,군) 조사 제거형이 존재하면 결합
      if (secondLevelName) {
        // 논산 + 취암 => 논산취암, 논산취암동
        result.push(secondLevelName + base, secondLevelName + full);
      }
      
      // top-level이 인천(인천광역시)라면 인천 + (주안, 주안동)
      if (prefixForDong) {
        result.push(prefixForDong + base, prefixForDong + full);
      }
      
      return result;
    }
    
    // '리'로 끝나는 경우 -> 그대로만. 예: '하길리'
    if (/리$/.test(removedNum)) {
      let result = [removedNum];
      if (secondLevelName) {
        result.push(secondLevelName + removedNum);
      }
      if (prefixForDong) {
        result.push(prefixForDong + removedNum);
      }
      return result;
    }

    if (/[^\p{L}\d\s가-힣ㄱ-ㅎㅏ-ㅣ]/gu.test(token)) {
        // 특수문자 제거 후 의미 있는 텍스트만 남으면 사용, 그렇지 않으면 스킵
        let cleaned = token.replace(/[^\p{L}\d\s가-힣ㄱ-ㅎㅏ-ㅣ]/gu, '');
        if (!cleaned || /^\d+$/.test(cleaned)) 
            return []; // 숫자만 남으면 빈 배열 반환하여 처리 스킵
        token = cleaned;
    }
    
    // 이 함수에 있는 default return이 없는 것 같으니 추가
    return [token]; // 다른 조건에 해당하지 않는 경우 토큰 자체를 반환
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // 테스트용 샘플: 문제에서 제시된 7가지 주소 예시
  // ─────────────────────────────────────────────────────────────────────────────
  
  const samples = [
    // 1. "서울특별시 중구 명동8길 8-11 1,2층(명동2가)"
    "서울특별시 중구 명동8길 8-11 1,2층(명동2가)",
    // 2. "인천 미추홀구 인주대로 410 (주안동, 탑클래시아) 101호"
    "인천 미추홀구 인주대로 410 (주안동) 101호",
    // 3. "충남 논산시 중앙로398번길 13-2 (취암동) 1층"
    "충남 논산시 중앙로398번길 13-2 (취암동) 1층",
    // 4. "경기 수원시 팔달구 인계동 1118 진재로 108"
    "경기 수원시 팔달구 인계동 1118 진재로 108",
    // 5. "경기 수원시 팔달구 인계동"
    //   (성의 없는 주소라 가정. 실제 규칙은 동일)
    "경기 수원시 팔달구 인계동",
    // 6. "경기 화성시 상신하길로 320 (하길리) 105,106호"
    "경기 화성시 상신하길로 320 (하길리) 105,106호",
    // 7. "전남 무안군 대죽동로16번길 25 (남악리) 103.104호 927++"
    "전남 무안군 대죽동로16번길 25 (남악리) 103.104호 927++"
  ];
  
  samples.forEach((addr, idx) => {
    const result = extractAddressKeywords(addr);
    console.log(`\n[${idx+1}번 주소]`, addr);
    console.log(`=> 추출 키워드:`, result);
  });