// 解析用户账户信息，支持只读权限
function parseUserAccount(account, context) {
    let isReadOnly = false;
    let permissions = null;

    // 先检查普通用户
    if(context.env[account]) {
        permissions = context.env[account].split(",");
        isReadOnly = false;
    }
    // 再检查只读用户
    else if(context.env[account + ':r']) {
        permissions = context.env[account + ':r'].split(",");
        isReadOnly = true;
    }

    return {
        exists: !!permissions,
        permissions: permissions || [],
        isReadOnly: isReadOnly,
        actualAccount: account
    };
}

export function get_auth_status(context) {
    var dopath = context.request.url.split("/api/write/items/")[1]

    console.log('get_auth_status - checking write permission for path:', dopath);

    const guestEnv = context.env["GUEST"] || context.env["guest"];
    if(guestEnv){
        if(dopath.startsWith("_$flaredrive$/thumbnails/"))return true;
        const allow_guest = guestEnv.split(",")
        for (var aa of allow_guest){
            if(aa == "*"){
                return true
            }else if(dopath.startsWith(aa)){
                return true
            }
        }
    }
    var headers = new Headers(context.request.headers);
    if(!headers.get('Authorization'))return false
    const Authorization=headers.get('Authorization').split("Basic ")[1]
    const account = atob(Authorization);
    if(!account)return false

    // 解析用户账户信息
    const userInfo = parseUserAccount(account, context);
    if(!userInfo.exists)return false;

    // 只读用户不能进行写操作
    if(userInfo.isReadOnly) {
        console.log('get_auth_status - read-only user cannot write');
        return false;
    }

    if(dopath.startsWith("_$flaredrive$/thumbnails/"))return true;
    const allow = userInfo.permissions;

    console.log('get_auth_status - user permissions:', allow);
    console.log('get_auth_status - checking path:', dopath);

    for (var a of allow){
        console.log('get_auth_status - checking permission:', a, 'against path:', dopath);
        if(a == "*"){
            console.log('get_auth_status - admin access granted');
            return true;
        }else if(dopath.startsWith(a)){
            console.log('get_auth_status - permission granted for path');
            return true;
        }
    }

    // 检查是否是游客目录 - 已登录用户也应该能访问游客目录
    if(guestEnv){
        const allow_guest = guestEnv.split(",")
        console.log('get_auth_status - checking guest permissions:', allow_guest);
        for (var aa of allow_guest){
            console.log('get_auth_status - checking guest permission:', aa, 'against path:', dopath);
            if(aa == "*"){
                console.log('get_auth_status - guest admin access granted');
                return true
            }else if(dopath.startsWith(aa)){
                console.log('get_auth_status - guest permission granted for path');
                return true
            }
        }
    }

    console.log('get_auth_status - no permission found, access denied');
    return false;
  }

// 新增：检查文件列表访问权限
export function get_list_auth_status(context, path = "") {
    var headers = new Headers(context.request.headers);

    console.log('get_list_auth_status - path:', path);
    console.log('get_list_auth_status - Authorization header:', headers.get('Authorization'));

    // 检查是否有登录用户
    if(headers.get('Authorization')) {
        const Authorization = headers.get('Authorization').split("Basic ")[1]
        const account = atob(Authorization);
        console.log('get_list_auth_status - decoded account:', account);
        console.log('get_list_auth_status - env[account] exists:', !!context.env[account]);

        // 解析用户账户信息
        const userInfo = parseUserAccount(account, context);
        if(userInfo.exists) {
            // 已登录用户，检查目录权限
            const allow = userInfo.permissions;
            console.log('get_list_auth_status - user permissions:', allow);
            console.log('get_list_auth_status - user isReadOnly:', userInfo.isReadOnly);
            console.log('get_list_auth_status - checking path:', path);

            // 特殊情况：根目录始终允许访问，以便显示用户有权限的子目录
            if(path === "") {
                console.log('get_list_auth_status - root access granted for logged user');
                return { hasAccess: true, isGuest: false };
            }

            for (var a of allow){
                console.log('get_list_auth_status - checking permission:', a, 'against path:', path);
                if(a == "*"){
                    console.log('get_list_auth_status - admin access granted');
                    return { hasAccess: true, isGuest: false };
                }else {
                    // 标准化路径比较：确保两边都有或都没有尾部斜杠
                    const normalizedPath = path.endsWith('/') ? path : path + '/';
                    const normalizedPermission = a.endsWith('/') ? a : a + '/';

                    console.log('get_list_auth_status - normalized comparison:', normalizedPath, 'vs', normalizedPermission);

                    if(normalizedPath.startsWith(normalizedPermission) || normalizedPermission.startsWith(normalizedPath)){
                        console.log('get_list_auth_status - path access granted');
                        return { hasAccess: true, isGuest: false };
                    }
                }
            }

            // 检查是否是游客目录 - 已登录用户也应该能访问游客目录
            const guestEnv = context.env["GUEST"] || context.env["guest"];
            if(guestEnv && path !== "") {
                const allow_guest = guestEnv.split(",");
                for (var aa of allow_guest){
                    if(aa == "*"){
                        console.log('get_list_auth_status - logged user accessing guest admin directory');
                        return { hasAccess: true, isGuest: false };
                    }else {
                        const normalizedPath = path.endsWith('/') ? path : path + '/';
                        const normalizedGuestPermission = aa.endsWith('/') ? aa : aa + '/';

                        if(normalizedPath.startsWith(normalizedGuestPermission) || normalizedGuestPermission.startsWith(normalizedPath)){
                            console.log('get_list_auth_status - logged user accessing guest directory');
                            return { hasAccess: true, isGuest: false };
                        }
                    }
                }
            }

            console.log('get_list_auth_status - no matching permissions for non-root path');
            return { hasAccess: false, isGuest: false };
        } else {
            console.log('get_list_auth_status - account not found or invalid');
        }
    } else {
        console.log('get_list_auth_status - no Authorization header');
    }

    // 未登录用户，检查游客权限
    console.log('get_list_auth_status - checking guest permissions');
    console.log('get_list_auth_status - GUEST env var:', context.env["GUEST"]);
    console.log('get_list_auth_status - guest env var:', context.env["guest"]);

    const guestEnv = context.env["GUEST"] || context.env["guest"];
    if(guestEnv){
        const allow_guest = guestEnv.split(",")
        console.log('get_list_auth_status - guest permissions:', allow_guest);

        // 特殊情况：根目录始终允许游客访问，以便显示游客有权限的子目录
        if(path === "" && allow_guest.length > 0) {
            console.log('get_list_auth_status - root access granted for guest');
            return { hasAccess: true, isGuest: true };
        }

        for (var aa of allow_guest){
            console.log('get_list_auth_status - checking guest permission:', aa, 'against path:', path);
            if(aa == "*"){
                console.log('get_list_auth_status - guest admin access granted');
                return { hasAccess: true, isGuest: true };
            }else {
                // 标准化路径比较：确保两边都有或都没有尾部斜杠
                const normalizedPath = path.endsWith('/') ? path : path + '/';
                const normalizedPermission = aa.endsWith('/') ? aa : aa + '/';

                console.log('get_list_auth_status - guest normalized comparison:', normalizedPath, 'vs', normalizedPermission);

                if(normalizedPath.startsWith(normalizedPermission) || normalizedPermission.startsWith(normalizedPath)){
                    console.log('get_list_auth_status - guest path access granted');
                    return { hasAccess: true, isGuest: true };
                }
            }
        }
        console.log('get_list_auth_status - no matching guest permissions for non-root path');
        return { hasAccess: false, isGuest: true };
    } else {
        console.log('get_list_auth_status - no GUEST env var, allowing all guest access');
        // 如果没有设置 GUEST 权限，允许游客访问所有内容
        return { hasAccess: true, isGuest: true };
    }
}
