/**------【①.谋而后定：配置区】-----**/

import Mustache from './mustache.js';
import index from './themes/index.html';
import article from './themes/article.html';
import login from './themes/login.html';
import adminIndex from './themes/admin/index.html';
import adminEdit from './themes/admin/edit.html';
import adminSetting from './themes/admin/setting.html';
import adminPublish from './themes/admin/publish.html';
import logoFile from './logo/logo.png';

const THEMES = {
  'index': index,
  'article': article,
  'login': login,
  'admin/index': adminIndex,
  'admin/edit': adminEdit,
  'admin/setting': adminSetting,
  'admin/publish': adminPublish,
};

// 我们将在请求处理函数中加载环境变量
const ACCOUNT = { //账号相关，安全性更高
  "user" : "", // 将在请求处理时动态获取
  "password" : "", // 将在请求处理时动态获取
  "jwt_secret": "", // 新增：用于JWT签名的密钥
  "cacheZoneId": "", // 将在请求处理时动态获取
  "cacheToken": "", // 将在请求处理时动态获取

  "kv_var": this['CFBLOG'],//workers绑定kv时用的变量名
}

const OPT = { //网站配置

  /*--前台参数--*/
  "siteDomain" : "blog.cuger.nyc.mn",// 域名(不带https 也不带/)
  "siteName" : "CFBLOG-Plus",//博客名称
  "siteDescription":"CFBLOG-Plus" ,//博客描述
  "keyWords":"cloudflare,KV,workers,blog",//关键字
  "logo":"/logo/logo.png",//logo

  //"search_xml_url":"", //search.xml外部链接，可通过github的action自动生成，不设置则实时生成
  //"sitemap_xml_url":"", //sitemap.xml外部链接，可通过github的action自动生成，不设置则实时生成
  
  "pageSize" : 5,//每页文章数
  "recentlySize" : 6,//最近文章数
  "recentlyType" : 1,//最近文章类型：1-按创建时间倒序（按id倒序），2-按修改时间排序
  "readMoreLength":150,//阅读更多截取长度
  "cacheTime" : 60*60*24*2, //文章在浏览器的缓存时长(秒),建议=文章更新频率
  "html404" : `<b>404</b>`,//404页面代码
  "copyRight" :`Powered by <a href="https://www.cloudflare.com">Cloudflare</a>`,//自定义版权信息,建议保留大公无私的 Coudflare 和 作者 的链接
  "robots":`User-agent: *
Disallow: /admin`,//robots.txt设置
  
  /*--前后台共用参数--*/
  
  "top_flag":`<topflag>[置顶]</topflag>`,//置顶标志
  "top_flag_style":`<style>topflag {color:#ff5722}</style>`,//置顶标志的样式


  /*--后台参数--*/

  "hidden_flag":`<hiddenflag>[隐藏]</hiddenflag>`,//隐藏标志
  "hidden_flag_style":`<style>hiddenflag {color:#000000;background-color: #ffff00;}</style>`,//隐藏标志的样式
  

};

//---对部分配置进行处理---
{
  //CFBLOG 通用变量
  this.CFBLOG = ACCOUNT.kv_var;
  
  //默认为非私密博客
  if(null==OPT.privateBlog){
    OPT.privateBlog=false;
  }
  //处理themeURL参数设定
}


/**------【②.猎杀时刻：请求处理入口】-----**/

// 全局变量，用于存储环境变量
let ENV_VARIABLES_LOADED = false;

// 修改loadEnvVariables函数
function loadEnvVariables() {
  if (ENV_VARIABLES_LOADED) return;
  
  try {
    ACCOUNT.user = typeof BLOG_USER !== 'undefined' ? BLOG_USER : "";
    ACCOUNT.password = typeof BLOG_PASSWORD !== 'undefined' ? BLOG_PASSWORD : "";
    ACCOUNT.jwt_secret = typeof BLOG_JWT_SECRET !== 'undefined' ? BLOG_JWT_SECRET : "a-very-secret-and-long-default-key-for-testing";
    ACCOUNT.cacheZoneId = typeof BLOG_CACHE_ZONE_ID !== 'undefined' ? BLOG_CACHE_ZONE_ID : "";
    ACCOUNT.cacheToken = typeof BLOG_CACHE_TOKEN !== 'undefined' ? BLOG_CACHE_TOKEN : "";

    if (ACCOUNT.jwt_secret === "a-very-secret-and-long-default-key-for-testing") {
      console.warn("警告：正在使用默认的JWT密钥。为了生产环境的安全，请在Cloudflare环境变量中设置一个强随机字符串的'BLOG_JWT_SECRET'。");
    }
    
    ENV_VARIABLES_LOADED = true;
    console.log("环境变量加载成功");
  } catch (e) {
    console.error("环境变量加载失败", e);
  }
}

// 在addEventListener中调用一次
addEventListener("fetch", event => {
  // 只加载一次环境变量
  if (!ENV_VARIABLES_LOADED) {
    loadEnvVariables();
  }
  
  // 处理请求
  event.respondWith(handlerRequest(event));
});

// 处理请求
async function handlerRequest(event){
  let request = event.request
  let url = new URL(request.url)
  let paths = url.pathname.trim("/").split("/")

  // 关键检查：确认KV是否已正确绑定
  if (typeof CFBLOG === 'undefined' || CFBLOG === null) {
    const errorMsg = '{"msg":"KV binding missing. Please bind a KV namespace to the variable name CFBLOG in your Worker settings.","rst":false}';
    return new Response(errorMsg, {
      headers: { "content-type": "application/json;charset=UTF-8" },
      status: 500
    });
  }

  // 静态资源缓存时间更长
  const isStaticResource = /\.(js|css|jpg|jpeg|png|gif|ico)$/i.test(url.pathname);
  const cacheTtl = isStaticResource ? 60*60*24*7 : OPT.cacheTime; // 静态资源缓存7天
  
  // 处理登录页面请求
  if (paths[0] === "login") {
    return await handle_login(request);
  }

  // 修改校验权限的逻辑
  if (("admin" == paths[0] || true === OPT.privateBlog)) {
    // 检查cookie中的auth令牌
    // 如果认证失败，重定向到登录页
    if (!await parseBasicAuth(request)) {
      return new Response("Redirecting to login...", {
        status: 302,
        headers: {
          "Location": "/login"
        }
      });
    }
  }
  
  // 尝试从缓存获取，仅对GET请求
  if (request.method === 'GET') {
    // 构建缓存键
    const cacheKey = "https://" + OPT.siteDomain + url.pathname;
    const cache = caches.default;
    
    // 尝试从缓存获取
    let response = await cache.match(new Request(cacheKey, request));
    if (response) {
      console.log("命中缓存:", cacheKey);
      return response;
    }
  }

  // 处理实际请求
  let response;

  try {
    switch(paths[0]){
      case "logo":
        if (paths[1] === 'logo.png') {
            response = await handle_logo(request);
        } else {
            response = new Response(OPT.html404, {
              headers: { "content-type": "text/html;charset=UTF-8" },
              status: 404
            });
        }
        break;
      case "favicon.ico": //图标
        response = await handle_favicon(request);
        break;
      case "robots.txt":
        response = await handle_robots(request);
        break;
      case "sitemap.xml":
        response = await handle_sitemap(request);
        break;
      case "search.xml":
        response = await handle_search(request);
        break;
      case "admin": //后台
        response = await handle_admin(request);
        break;
      case "article": //文章内容页
        // 使用正则表达式从路径中提取6位数字ID，更健壮
        const match = url.pathname.match(/\/article\/(\d{6})/);
        if (match) {
          const articleId = match[1];
          response = await handle_article(articleId);
        } else {
          // 如果不匹配，则返回404
          response = new Response(OPT.html404, {
            headers: { "content-type": "text/html;charset=UTF-8" },
            status: 404
          });
        }
        break;
      case "": //文章 首页
      case "page": //文章 分页
      case "category": //分类 分页
      case "tags": //标签 分页
        response = await renderBlog(url);
        break;
      case "logout":
        response = new Response("Redirecting to login...", {
          status: 302,
          headers: {
            "Location": "/login",
            "Set-Cookie": `auth=; HttpOnly; Path=/; SameSite=Strict; Secure; Max-Age=0`
          }
        });
        break;
      default:
        //其他页面返回404
        response = new Response(OPT.html404, {
          headers: {
            "content-type": "text/html;charset=UTF-8"
          },
          status: 404
        });
        break;
    }
  } catch (error) {
    // 错误处理
    console.error("请求处理错误:", error);
    response = new Response("内部服务器错误: " + error.message, {
      status: 500,
      headers: {
        "Content-Type": "text/plain"
      }
    });
  }
  
  // 设置缓存
  if (request.method === 'GET' && response.ok && paths[0] !== 'admin') {
    try {
      // 克隆响应对象
      const cacheResponse = new Response(response.clone().body, response);
      // 设置缓存控制
      cacheResponse.headers.set('Cache-Control', `public, max-age=${cacheTtl}`);
      
      // 缓存响应
      const cacheKey = "https://" + OPT.siteDomain + url.pathname;
      event.waitUntil(caches.default.put(new Request(cacheKey, request), cacheResponse));
    } catch (e) {
      console.error("缓存设置错误:", e);
    }
  } else if (paths[0] === 'admin') {
    // 管理页面不缓存
    response.headers.set('Cache-Control', 'no-store');
  }
  
  return response;
}

/**------【③.分而治之：各种请求分开处理】-----**/

//访问: logo.png
async function handle_logo(request){
  return new Response(logoFile, {
    headers: { "content-type": "image/png" },
    status: 200
  });
}

//访问: favicon.ico
async function handle_favicon(request){
  /*
  想要自定义，或者用指定的ico，可将此请求置为404，并在codeBeforHead中自行添加类似代码：
    <link rel="icon" type="image/x-icon" href="https://cdn.jsdelivr.net/gh/gdtool/zhaopp/cfblog/favicon.ico" />
    <link rel="Shortcut Icon" href="https://cdn.jsdelivr.net/gh/gdtool/zhaopp/cfblog/favicon.ico">
  */
  /*
  return new Response("404",{
      headers:{
          "content-type":"text/plain;charset=UTF-8"
      },
      status:404
  });
  */
  let url = new URL(request.url)
  url.host="dash.cloudflare.com"
  return await fetch(new Request(url, request));
}

//访问: robots.txt
async function handle_robots(request){
  return new Response(OPT.robots+"\nSitemap: https://"+OPT.siteDomain+"/sitemap.xml",{
    headers:{
      "content-type":"text/plain;charset=UTF-8"
    },
    status:200
  });
}

//访问: sitemap.xml
async function handle_sitemap(request){
  //如果设置了参数，则使用参数指定的url
  //可使用github action方式自动定期更新
  let xml;
  if(OPT.sitemap_xml_url){
    
    //cf代理方式，速度可以，实时性更好
    let url = new URL(request.url)
    url.href = OPT.sitemap_xml_url.replace('cdn.jsdelivr.net/gh','raw.githubusercontent.com').replace('@','/');
    xml = await fetch(new Request(url, request));
    xml = await xml.text();
    
    ////302方式，如果使用jsdelivr作为cdn，速度快，但更新有延迟
    //return new Response("",{
    //    headers:{
    //        "location":OPT.sitemap_xml_url
    //    },
    //    status:302
    //});
  
  }else{ //未配置参数，则实时获取结构
  
    //读取文章列表，并按照特定的xml格式进行组装
    let articles_all=await getArticlesList()
    xml='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9 http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd" xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
    for(var i=0;i<articles_all.length;i++){
      xml+="\n\t<url>",
      xml+="\n\t\t<loc>https://"+OPT.siteDomain+"/article/"+articles_all[i].id+"/"+articles_all[i].link+".html</loc>",
      xml+="\n\t\t<lastmod>"+articles_all[i].createDate.substr(0,10)+"</lastmod>",
      xml+="\n\t\t<changefreq>"+(void 0===articles_all[i].changefreq?"daily":articles_all[i].changefreq)+"</changefreq>",
      xml+="\n\t\t<priority>"+(void 0===articles_all[i].priority?"0.5":articles_all[i].priority)+"</priority>",
      xml+="\n\t</url>";
    }
    xml+="\n</urlset>"
  }
  return new Response(xml,{
    headers:{
        "content-type":"text/xml;charset=UTF-8"
    },
    status:200
  });
}

//访问: search.xml
async function handle_search(request){
  //如果设置了参数，则使用参数指定的url
  //可使用github action方式自动定期更新
  let xml;
  if(OPT.search_xml_url){
    
    //cf代理方式，速度可以，实时性更好
    let url = new URL(request.url)
    url.href = OPT.search_xml_url.replace('cdn.jsdelivr.net/gh','raw.githubusercontent.com').replace('@','/');
    xml = await fetch(new Request(url, request));
    xml = await xml.text();
    
    ////302方式，如果使用jsdelivr作为cdn，速度快，但更新有延迟
    //return new Response("",{
    //    headers:{
    //        "location":OPT.search_xml_url
    //    },
    //    status:302
    //});
  
  }else{ //未配置参数，则实时获取结构
  
    //读取文章列表，并按照特定的xml格式进行组装
    let articles_all=await getArticlesList()
    xml='<?xml version="1.0" encoding="UTF-8"?>\n<blogs>';
    for(var i=0;i<articles_all.length;i++){
      xml+="\n\t<blog>",
      xml+="\n\t\t<title>"+articles_all[i].title+"</title>";
      let article = await getArticle(articles_all[i].id);
      if(null != article){
        xml+="\n\t\t<content>"+article.contentMD.replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('&','&amp;')+"</content>"
      }
      xml+="\n\t\t<url>https://"+OPT.siteDomain+"/article/"+articles_all[i].id+"/"+articles_all[i].link+".html</url>",
      xml+="\n\t\t<time>"+articles_all[i].createDate.substr(0,10)+"</time>",
      xml+="\n\t</blog>";
    }
    xml+="\n</blogs>"
  }
  return new Response(xml,{
    headers:{
      "content-type":"text/xml;charset=UTF-8"
    },
    status:200
  });
}

//渲染前端博客：指定一级路径page\tags\category，二级路径value，以及页码，默认第一页
async function renderBlog(url){
  console.log("---进入renderBlog函数---，path=", url.href.substr(url.origin.length))
  
  // 处理分页
  let pageSize=url.searchParams.get("pageSize");
  if(pageSize){
    OPT.pageSize=parseInt(pageSize);
  }
  
  // 批量获取所有必要的配置数据
  const config = await getBlogConfig();
  const {menus, categories, tags, links, articles_all, articles_recently} = config;
  
  // 获取主页模板源码 (并行加载)
  const theme_html = await getThemeHtml("index");
  
  /** 前台博客
   *  路径格式：
   *  域名/              文章列表首页，等价于域名/page/1
   *  域名/page/xxx      文章列表翻页
   * 
   *  域名/category/xxx  分类页，等价于域名/category/xxx/page/1
   *  域名/category/xxx/page/xxx  分类页+翻页
   * 
   *  域名/tags/xxx      标签页，等价于域名/tags/xxx/page/1
   *  域名/tags/xxx/page/xxx  分类页+翻页
   * 
   */
  let paths = url.pathname.trim("/").split("/")
  let articles=[],
      pageNo=1
  //获取文章列表
  switch(paths[0]||"page"){
  case "page":
    articles = articles_all
    pageNo = paths[1]||1
    break;
  case "tags":
  case "category":
    let category_tag = paths.slice(1).join("");//如果无分页，tags、category后面都是标签、分类名
    if(paths.length>3 && paths.includes("page")){
      pageNo = paths[paths.indexOf("page")+1] //分页的页码
      category_tag = paths.slice(1, paths.lastIndexOf("page")-1).join("") //tags、category后，分页前的为标签、分类名
    }
    category_tag = decodeURIComponent(category_tag)
    articles = articles_all.filter(a => a[paths[0]].includes(category_tag))
    break;
  }
  pageNo = parseInt(pageNo)
  
  //获取当页要显示文章列表
  let articles_show = articles.slice((pageNo-1)*OPT.pageSize,pageNo*OPT.pageSize);
  
  //处理文章属性（年月日、url等）
  processArticleProp(articles_show);

  let url_prefix = url.pathname.replace(/(.*)\/page\/\d+/,'$1/')
  if(url_prefix.substr(-1)=='/'){
    url_prefix=url_prefix.substr(0,url_prefix.length-1);
  }
  
  //组装各种参数
  let newer=[{title:"上一页",url:url_prefix+"/page/"+(pageNo-1)}];
  if(1==pageNo){
    newer=[];
  }
  let older=[{title:"下一页",url:url_prefix+"/page/"+(pageNo+1)}];
  if(pageNo*OPT.pageSize>=articles.length){
    older=[];
  }

  //文章标题、关键字
  let title=(pageNo>1 ? "page "+pageNo+" - " : "")+OPT.siteName,
      keyWord=OPT.keyWords,
      cfg={};
  cfg.widgetMenuList=menus,//导航
  cfg.widgetCategoryList=categories,//分类目录
  cfg.widgetTagsList=tags,//标签
  cfg.widgetLinkList=links,//链接
  cfg.widgetRecentlyList=articles_recently,//近期文章
  cfg.articleList=articles_show,//当前页文章列表
  cfg.pageNewer=newer,//上翻页链接
  cfg.pageOlder=older,//下翻页链接
  cfg.title=title,//网页title
  cfg.keyWords=keyWord;//SEO关键字
  
  //使用mustache.js进行页面渲染（参数替换）
  cfg.OPT=OPT
  
  let html = Mustache.render(theme_html,cfg)
  
  // 添加懒加载支持
  html = addLazyLoading(html);
  
  // 添加到返回博客页面的Response中
  function addLinkPreload(response, resources) {
    const linkHeaders = [];
    resources.forEach(resource => {
      linkHeaders.push(`<${resource.url}>; rel=preload; as=${resource.type}`);
    });
    
    if (linkHeaders.length > 0) {
      response.headers.set('Link', linkHeaders.join(', '));
    }
    
    return response;
  }
  
  let resources = [
    {url: OPT.themeURL + 'style.css', type: 'style'},
    {url: OPT.themeURL + 'main.js', type: 'script'}
  ];
  return addLinkPreload(new Response(html, {
    headers: {
      "content-type": "text/html;charset=UTF-8"
    },
    status: 200
  }), resources);
}

//渲染前端博客的文章内容页
async function handle_article(id){
    // 获取文章信息和内容页模板源码
    let currentArticle = await getArticle(id),
        theme_html = await getThemeHtml("article"),
        //KV中读取导航栏、分类目录、标签、链接、近期文章等配置信息
        menus = await getWidgetMenu(),
        categories = await getWidgetCategory(),
        tags = await getWidgetTags(),
        links = await getWidgetLink(),
        articles_recently = await getRecentlyArticles();
    
    // 如果文章不存在或已隐藏，返回404
    if(!currentArticle || currentArticle.hidden) {
        return new Response(OPT.html404,{
            headers:{
                "content-type":"text/html;charset=UTF-8"
            },
            status:404
        });
    }

    //获取上篇、本篇、下篇文章
    let articles_sibling = await getSiblingArticle(id);
    
    //处理文章属性（年月日、url等）
    processArticleProp(articles_sibling);
    
    //获取本篇文章
    let article = articles_sibling[1];

    //组装文章详情页各参数
    let title = article.title.replace(nullToEmpty(OPT.top_flag),'').replace(nullToEmpty(OPT.hidden_flag),'')+" - "+OPT.siteName,
        keyWord = article.tags.concat(article.category).join(","),
        cfg = {};
    cfg.widgetMenuList = menus,//导航
    cfg.widgetCategoryList = categories,//分类目录
    cfg.widgetTagsList = tags,//标签
    cfg.widgetLinkList = links,//链接
    cfg.widgetRecentlyList = articles_recently,//近期文章
    cfg.articleOlder = articles_sibling[0]?[articles_sibling[0]]:[],//上篇文章
    cfg.articleSingle = article,//本篇文章
    cfg.articleNewer = articles_sibling[2]?[articles_sibling[2]]:[],//下篇文章
    cfg.title = title,//网页title
    cfg.keyWords = keyWord;//SEO关键字
    
    //使用mustache.js进行页面渲染（参数替换）
    cfg.OPT = OPT
    
    let html = Mustache.render(theme_html,cfg)
    
    // 添加懒加载支持
    html = addLazyLoading(html);
    
    // 添加到返回博客页面的Response中
    function addLinkPreload(response, resources) {
      const linkHeaders = [];
      resources.forEach(resource => {
        linkHeaders.push(`<${resource.url}>; rel=preload; as=${resource.type}`);
      });
      
      if (linkHeaders.length > 0) {
        response.headers.set('Link', linkHeaders.join(', '));
      }
      
      return response;
    }
    
    let resources = [
      {url: OPT.themeURL + 'style.css', type: 'style'},
      {url: OPT.themeURL + 'main.js', type: 'script'}
    ];
    return addLinkPreload(new Response(html, {
      headers: {
        "content-type": "text/html;charset=UTF-8"
      },
      status: 200
    }), resources);
}

//后台请求处理
async function handle_admin(request){
  let url = new URL(request.url),
      paths = url.pathname.trim("/").split("/"),
      html, json, file;
  
  // CSRF保护
  let csrfToken;
  if (request.method === 'GET') {
    csrfToken = btoa(crypto.getRandomValues(new Uint8Array(16)));
  } else {
    // 对所有写操作（非GET请求）进行CSRF令牌验证
    const csrfHeader = request.headers.get('x-csrf-token');
    const cookies = request.headers.get('Cookie') || '';
    let csrfCookie = '';
    cookies.split(';').forEach(cookie => {
      const [name, value] = cookie.trim().split('=');
      if (name === 'csrf-token') {
        csrfCookie = value;
      }
    });

    if (!csrfHeader || !csrfCookie || csrfHeader !== csrfCookie) {
      return new Response('CSRF token mismatch', { status: 403 });
    }
  }

  //新建页
  if(1==paths.length||"list"==paths[1]){
    //读取主题的admin/index.html源码
    // 并行读取主题和配置数据
    const [theme_html, categoryJson, menuJson, linkJson] = await Promise.all([
      getThemeHtml("admin/index"),
      getWidgetCategory(),
      getWidgetMenu(),
      getWidgetLink()
    ]);
    // 使用 Mustache 渲染并传递 OPT
    html = Mustache.render(theme_html, {
        OPT,
        categoryJson,
        menuJson,
        linkJson
    });
    //添加置顶样式
    if(OPT.top_flag_style){
      html += OPT.top_flag_style
    }
    //添加隐藏样式
    if(OPT.hidden_flag_style){
      html += OPT.hidden_flag_style
    }
  }

  //发布
  if("publish"==paths[1]){
    const isAjax = request.headers.get('X-Requested-With') === 'XMLHttpRequest';

    // If it's an AJAX GET (from the broken button) or a proper POST, run the action.
    if (isAjax || request.method === 'POST') {
        try {
            console.log(`重建索引开始 (method: ${request.method}, ajax: ${isAjax})`);

            // 1. 递归获取所有文章的 key
            async function getAllArticleKeys(keys=[], cursor="") {
                const list = await CFBLOG.list({ prefix: "", limit: 1000, cursor: cursor });
                keys = keys.concat(list.keys);
                if (list.list_complete) {
                    return keys.filter(key => /^\d{6}$/.test(key.name));
                }
                return await getAllArticleKeys(keys, list.cursor);
            }
            const articleKeys = await getAllArticleKeys();

            // 2. 重新构建文章列表
            let new_articles_all = [];
            let maxId = 0;
            for (const key of articleKeys) {
                const articleJson = await CFBLOG.get(key.name);
                if (articleJson) {
                    try {
                        const article = JSON.parse(articleJson);
                        const articleListItem = {
                            id: article.id,
                            title: article.title,
                            img: article.img || '',
                            link: article.link || '',
                            createDate: article.createDate,
                            category: article.category || [],
                            tags: article.tags || [],
                            contentText: article.contentText || '',
                            priority: article.priority || '0.5',
                            top_timestamp: article.top_timestamp || 0,
                            modify_timestamp: article.modify_timestamp || new Date().getTime(),
                            hidden: article.hidden || 0,
                            changefreq: article.changefreq || 'daily'
                        };
                        new_articles_all.push(articleListItem);
                        const currentId = parseInt(article.id);
                        if (!isNaN(currentId) && currentId > maxId) {
                            maxId = currentId;
                        }
                    } catch (e) {
                        console.error(`解析文章失败，已跳过: ${key.name}`, e);
                    }
                }
            }

            // 4. 排序并保存新的文章列表
            new_articles_all = sortArticle(new_articles_all);
            await saveArticlesList(JSON.stringify(new_articles_all));
            
            // 5. 更新文章序号
            await saveIndexNum(maxId);

            // 6. 更新标签
            let tags = [];
            for (const article of new_articles_all) {
                if (Array.isArray(article.tags)) {
                    for (const tag of article.tags) {
                        if (tag && !tags.includes(tag)) {
                            tags.push(tag);
                        }
                    }
                }
            }
            await saveWidgetTags(JSON.stringify(tags));
            
            // 7. 清除缓存并返回JSON
            await purge();
            json = `{"msg":"索引重建和发布成功，共处理 ${new_articles_all.length} 篇文章，缓存已清理。","rst":true}`;
            console.log("索引重建成功。");

        } catch (error) {
            console.error("发布/重建索引时发生严重错误:", error);
            json = `{"msg":"发布失败，服务端异常: ${error.message.replace(/"/g, "'")}","rst":false}`;
        }
    } else {
        // For normal GET requests (page load), render the HTML page.
        let theme_html = await getThemeHtml("admin/publish");
        html = Mustache.render(theme_html, { OPT });
    }
  }

  //文章列表
  if("getList"==paths[1]){
    //默认取第一页，每页20篇
    let pageNo=(undefined===paths[2]) ? 1 : parseInt(paths[2]),
        pageSize = 20,
        list=await admin_nextPage(pageNo, pageSize);//每次加载20个
    
    // 获取文章总数以计算总页数
    const allArticles = await getAllArticlesList();
    const totalPages = Math.ceil(allArticles.length / pageSize);

    json = JSON.stringify({
      articles: list,
      currentPage: pageNo,
      totalPages: totalPages
    });
  }
  
  //修改文章
  if("edit"==paths[1]){
    let id=paths[2];
    const [
        theme_html,
        categoryJson,
        tagJson,
        menuJson,
        linkJson,
        recentlyArticles,
        articleJson
    ] = await Promise.all([
        getThemeHtml("admin/edit"),
        getWidgetCategory(),
        getWidgetTags(),
        getWidgetMenu(),
        getWidgetLink(),
        getRecentlyArticles(),
        getArticle(id)
    ]);
    html = Mustache.render(theme_html, {
        OPT,
        categoryJson: JSON.stringify(categoryJson),
        tagJson: JSON.stringify(tagJson),
        menuJson,
        linkJson,
        recentlyArticles,
        articleJson
    });
  }
  
  //保存配置
  if("saveConfig"==paths[1]){
    const ret=await parseReq(request);
    // 兼容前端传递的 [{name: type, value: value}, {name: 'action', value: action}]
    let type = ret.WidgetCategory ? 'WidgetCategory' : ret.WidgetMenu ? 'WidgetMenu' : ret.WidgetLink ? 'WidgetLink' : ret.WidgetTags ? 'WidgetTags' : null;
    let value = ret[type];
    let action = ret.action;
    let success = false;
    if(type && action && value){
        let list = [];
        if(type === 'WidgetCategory') list = await getWidgetCategory();
        if(type === 'WidgetTags') list = await getWidgetTags();
        if(type === 'WidgetMenu') list = await getWidgetMenu();
        if(type === 'WidgetLink') list = await getWidgetLink();
        if(action === 'add'){
            if(type === 'WidgetMenu' || type === 'WidgetLink'){
                // value 是字符串，需要 parse 成对象
                let obj = value;
                if(typeof value === 'string'){
                    try { obj = JSON.parse(value); } catch(e) { obj = null; }
                }
                if(obj && obj.title && obj.url){
                    // 避免重复 title
                    if(!list.some(item => item.title === obj.title)){
                        list.push(obj);
                    }
                }
            }else{
                // 分类/标签为字符串数组
                if(Array.isArray(list)){
                    if(!list.includes(value)) list.push(value);
                }
            }
        }
        if(action === 'remove'){
            if(type === 'WidgetMenu' || type === 'WidgetLink'){
                // value 是 title
                list = list.filter(item => item.title !== value);
            }else{
                if(Array.isArray(list)){
                    list = list.filter(item => item !== value);
                }
            }
        }
        if(type === 'WidgetCategory') success = await saveWidgetCategory(JSON.stringify(list));
        if(type === 'WidgetMenu') success = await saveWidgetMenu(JSON.stringify(list));
        if(type === 'WidgetLink') success = await saveWidgetLink(JSON.stringify(list));
        if(type === 'WidgetTags') success = await saveWidgetTags(JSON.stringify(list));
        json = success ? '{"msg":"saved","rst":true}' : '{"msg":"Save Faild!!!","ret":false}';
    }else{
        json = '{"msg":"Not a JSON object or missing params","rst":false}';
    }
  }
  
  //导入
  if("import"==paths[1]){
    try {
      const ret = await parseReq(request);
      let importJson = ret.importJson;
      console.log("开始导入", typeof importJson);
      
      if(checkFormat(importJson)){
        let importData = JSON.parse(importJson);
        let keys = Object.keys(importData);
        let successCount = 0;
        let maxId = 0;
        
        // 处理系统配置（如果存在）
        if(importData.OPT) {
          // 导入分类
          if(importData.OPT.widgetCategory) {
            await saveWidgetCategory(JSON.stringify(importData.OPT.widgetCategory));
          }
          // 导入菜单
          if(importData.OPT.widgetMenu) {
            await saveWidgetMenu(JSON.stringify(importData.OPT.widgetMenu));
          }
          // 导入链接
          if(importData.OPT.widgetLink) {
            await saveWidgetLink(JSON.stringify(importData.OPT.widgetLink));
          }
          
          // 如果导入的数据中包含SYSTEM_VALUE开头的配置
          for(let key of keys) {
            if(key.startsWith('SYSTEM_VALUE_')) {
              await saveKV(key, JSON.stringify(importData[key]));
            }
          }
        }
        
        // 获取当前文章列表
        let currentArticles = await getAllArticlesList() || [];
        let newArticles = [];
        
        // 处理每篇文章
        for(let i=0; i<keys.length; i++){
          // 跳过系统配置和系统值
          if(keys[i] === 'OPT' || keys[i].startsWith('SYSTEM_VALUE_')) continue;
          
          let article = importData[keys[i]];
          if(!article || !article.id) continue;
          
          // 安全检查：防止ID覆盖系统关键值
          if (article.id.startsWith('SYSTEM_')) {
            console.error("安全警告：检测到尝试使用系统保留ID进行导入，已跳过:", article.id);
            continue;
          }
          
          try {
            // 保存文章内容
            await saveArticle(article.id, JSON.stringify(article));
            
            // 更新最大ID
            let currentId = parseInt(article.id);
            if(!isNaN(currentId) && currentId > maxId) {
              maxId = currentId;
            }
            
            // 构建文章列表对象
            let articleListItem = {
              id: article.id,
              title: article.title,
              img: article.img || '',
              link: article.link || '',
              createDate: article.createDate,
              category: article.category || [],
              tags: article.tags || [],
              contentText: article.contentText || '',
              priority: article.priority || '0.5',
              top_timestamp: article.top_timestamp || 0,
              modify_timestamp: article.modify_timestamp || new Date().getTime(),
              hidden: article.hidden || 0,
              changefreq: article.changefreq || 'daily'
            };
            
            newArticles.push(articleListItem);
            successCount++;
          } catch(e) {
            console.error("导入单篇文章失败:", article.id, e);
          }
        }
        
        // 合并文章列表并去重
        let mergedArticles = currentArticles.filter(current => 
          !newArticles.some(newArticle => newArticle.id === current.id)
        );
        mergedArticles = mergedArticles.concat(newArticles);
        
        // 排序文章列表
        mergedArticles = sortArticle(mergedArticles);
        
        // 保存更新后的文章列表
        await saveArticlesList(JSON.stringify(mergedArticles));
        
        // 获取当前的序号
        let currentIndexNum = await getIndexNum();
        currentIndexNum = parseInt(currentIndexNum);
        
        // 确保maxId大于当前序号
        if(!isNaN(currentIndexNum) && currentIndexNum > maxId) {
          maxId = currentIndexNum;
        }
        
        // 保存新的序号
        console.log("更新文章序号为:", maxId);
        await saveIndexNum(maxId);
        
        // 清理缓存
        await purge();
        
        json = JSON.stringify({
          status: "success",
          message: `成功导入 ${successCount} 篇文章，系统配置已更新`,
          totalArticles: mergedArticles.length,
          newIndexNum: maxId
        });
      } else {
        json = JSON.stringify({
          status: "error",
          message: "导入的JSON格式不正确"
        });
      }
    } catch(e) {
      console.error("导入处理出错:", e);
      json = JSON.stringify({
        status: "error",
        message: "导入处理失败: " + e.message
      });
    }
  }
  
  //导出
  if("export"===paths[1]){
    console.log("开始导出");
    async function exportArticle(arr=[],cursor="",limit=1){
      //分页获取文章内容
      const list=await CFBLOG.list({limit:limit,cursor:cursor});
      if(!1 in list) return {};
      arr=arr.concat(list.keys)
      console.log("导出: ",typeof list, JSON.stringify(list))
      //判断是否导出完毕
      if(list.list_complete){
        let ret = {OPT:OPT};
        for(let i=0;i<arr.length;++i){
          const article = await CFBLOG.get(arr[i].name);
          if(null != article){
            ret[arr[i].name] = checkFormat(article)?JSON.parse(article):article
          }
        }
        return ret
      }
      return await exportArticle(arr,list.cursor,limit)
    }
    
    let articles=await exportArticle();
    file = {
      name: "cfblog-"+new Date().getTime()+".json",
      content: JSON.stringify(articles)
    }
  }
  
  //导出search.xml 
  if("search.xml"===paths[1]){
    console.log("开始导出");
    //读取文章列表，并按照特定的xml格式进行组装
    let articles_all = await getArticlesList(); // 使用过滤后的文章列表
    let xml='<?xml version="1.0" encoding="UTF-8"?>\n<blogs>';
    for(var i=0; i<articles_all.length; i++){
      xml+="\n\t<blog>",
      xml+="\n\t\t<title>"+articles_all[i].title+"</title>";
      let article = await getArticle(articles_all[i].id);
      if(null != article){
        xml+="\n\t\t<content>"+article.contentMD.replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('&','&amp;')+"</content>"
      }
      xml+="\n\t\t<url>https://"+OPT.siteDomain+"/article/"+articles_all[i].id+"/"+articles_all[i].link+".html</url>",
      xml+="\n\t\t<time>"+articles_all[i].createDate.substr(0,10)+"</time>",
      xml+="\n\t</blog>";
    }
    xml+="\n</blogs>"
    file = {
      name: "search.xml",
      content: xml
    }
  }
  
  //导出sitemap.xml 
  if("sitemap.xml"===paths[1]){
    console.log("开始导出");
    //读取文章列表，并按照特定的xml格式进行组装
    let articles_all=await getArticlesList()
    let xml='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9 http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd" xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
    for(var i=0;i<articles_all.length;i++){
      xml+="\n\t<url>",
      xml+="\n\t\t<loc>https://"+OPT.siteDomain+"/article/"+articles_all[i].id+"/"+articles_all[i].link+".html</loc>",
      xml+="\n\t\t<lastmod>"+articles_all[i].createDate.substr(0,10)+"</lastmod>",
      xml+="\n\t\t<changefreq>"+(void 0===articles_all[i].changefreq?"daily":articles_all[i].changefreq)+"</changefreq>",
      xml+="\n\t\t<priority>"+(void 0===articles_all[i].priority?"0.5":articles_all[i].priority)+"</priority>",
      xml+="\n\t</url>";
    }
    xml+="\n</urlset>"
    file = {
      name: "sitemap.xml",
      content: xml
    }
  }
  
  //新建文章
  if("saveAddNew"==paths[1]){
    const ret=await parseReq(request);
    let title=ret.title,//文章标题
        img=ret.img,//插图
        link=ret.link,//永久链接
        createDate=ret.createDate.replace('T',' '),//发布日期
        category=ret.category,//分类
        tags=ret.tags,//标签
        priority=void 0===ret.priority?"0.5":ret.priority,//权重
        changefreq=void 0===ret.changefreq?"daily":ret.changefreq,//更新频率
        contentMD=ret["content-markdown-doc"],//文章内容-md格式
        contentHtml=ret["content-html-code"],//文章内容-html格式
        contentText="",//文章摘要
        top_timestamp=ret.top_timestamp*1,//置顶时间戳，不置顶时为0
        modify_timestamp=new Date().getTime()+8*60*60*1000,//修改时间戳
        hidden=ret.hidden*1,//是否隐藏
        id="";//文章id
    
    //校验参数完整性
    if(title.length>0
      && createDate.length>0
      && category.length>0
      && contentMD.length>0
      && contentHtml.length>0){

      id=await generateId(),
      contentText=contentHtml.replace(/<\/?[^>]*>/g,"").trim().substring(0,OPT.readMoreLength);//摘要
      //组装文章json
      let article={
        id:id,
        title:title,
        img:img,
        link:link,
        createDate:createDate,
        category:category,
        tags:tags,
        contentMD:contentMD,
        contentHtml:contentHtml,
        contentText:contentText,
        priority:priority,
        top_timestamp:top_timestamp,
        modify_timestamp:modify_timestamp,
        hidden:hidden,
        changefreq:changefreq
      };
      
      //将文章json写入KV（key为文章id，value为文章json字符串）
      await saveArticle(id,JSON.stringify(article));
      
      //组装文章json
      let articleWithoutHtml={
        id:id,
        title:title,
        img:img,
        link:link,
        createDate:createDate,
        category:category,
        tags:tags,
        contentText:contentText,
        priority:priority,
        top_timestamp:top_timestamp,
        modify_timestamp:modify_timestamp,
        hidden:hidden,
        changefreq:changefreq
      },
      articles_all_old=await getAllArticlesList(),//读取文章列表
      articles_all=[];
    
      //将最新的文章写入文章列表中，并按id排序后，再次回写到KV中
      articles_all.push(articleWithoutHtml),
      articles_all=articles_all.concat(articles_all_old),
      articles_all=sortArticle(articles_all),
      await saveArticlesList(JSON.stringify(articles_all))
      
      // 清除文章列表缓存并清理CF缓存
      MEMORY_CACHE.clear(); // 清除所有内存缓存以确保一致性
      await purge(['all']); // 新增文章影响较大，暂时清理所有

      json = '{"msg":"added OK","rst":true,"id":"'+id+'"}'
    }else{
      json = '{"msg":"信息不全","rst":false}'
    }
  }
  
  //删除
  if("delete"==paths[1]){
    let id=paths[2]
    if(6==id.length){
      try {
        // 1. 首先删除文章内容
        await CFBLOG.delete(id);
        console.log(`文章内容删除成功: ${id}`);
        
        // 2. 获取并更新文章列表
        let articles = await getAllArticlesList();
        let originalLength = articles.length;
        articles = articles.filter(article => article.id !== id);
        
        if(articles.length < originalLength){
          // 3. 保存更新后的文章列表
          let saveResult = await saveArticlesList(JSON.stringify(articles));
          console.log(`文章列表更新结果: ${saveResult}`);
          
          // 4. 更新文章序号
          let indexNum = articles.length > 0 ? 
            Math.max(...articles.map(a => parseInt(a.id))) : 0;
          await saveIndexNum(indexNum);
          console.log(`文章序号已更新为: ${indexNum}`);
          
          // 5. 强制清除缓存
          let purgeResult = await purge(['all']); // 删除文章影响较大，暂时清理所有
          console.log(`缓存清除结果: ${purgeResult}`);
          
          // 6. 返回成功响应
          json = JSON.stringify({
            status: "success",
            message: "文章删除成功",
            id: id,
            purged: purgeResult,
            newIndexNum: indexNum
          });
        } else {
          json = JSON.stringify({
            status: "error",
            message: "文章在列表中未找到",
            id: id
          });
        }
      } catch(e) {
        console.error("删除文章时出错:", e);
        json = JSON.stringify({
          status: "error",
          message: "删除文章时发生错误: " + e.message,
          id: id
        });
      }
    } else {
      json = JSON.stringify({
        status: "error",
        message: "无效的文章ID",
        id: id
      });
    }
  }

  // 批量删除
  if("batchDelete"==paths[1]){
    try {
      const ids = await request.json();
      if (!Array.isArray(ids) || ids.length === 0) {
        return new Response('{"msg":"无效的ID列表","rst":false}', { status: 400 });
      }

      // 1. 批量删除文章内容
      await CFBLOG.delete(ids);
      console.log(`文章内容批量删除成功: ${ids.join(', ')}`);

      // 2. 获取并更新文章列表
      let articles = await getAllArticlesList();
      let originalLength = articles.length;
      articles = articles.filter(article => !ids.includes(article.id));

      if (articles.length < originalLength) {
        // 3. 保存更新后的文章列表
        await saveArticlesList(JSON.stringify(articles));
        
        // 4. 更新文章序号
        let indexNum = articles.length > 0 ?
          Math.max(...articles.map(a => parseInt(a.id))) : 0;
        await saveIndexNum(indexNum);

        // 5. 强制清除缓存
        await purge(['all']); // 批量删除影响较大，暂时清理所有

        json = '{"msg":"批量删除成功","rst":true}';
      } else {
        json = '{"msg":"未找到要删除的文章","rst":false}';
      }
    } catch (e) {
      console.error("批量删除文章时出错:", e);
      json = `{"msg":"批量删除失败: ${e.message}","rst":false}`;
    }
  }
  
  //保存编辑的文章
  if("saveEdit"==paths[1]){
    const ret=await parseReq(request);
    let title=ret.title,//文章标题
        img=ret.img,//插图
        link=ret.link,//永久链接
        createDate=ret.createDate.replace('T',' '),//发布日期
        category=ret.category,//分类
        tags=ret.tags,//标签
        priority=void 0===ret.priority?"0.5":ret.priority,//权重
        changefreq=void 0===ret.changefreq?"daily":ret.changefreq,//更新频率
        contentMD=ret["content-markdown-doc"],//文章内容-md格式
        contentHtml=ret["content-html-code"],//文章内容-html格式
        contentText="",//文章摘要
        top_timestamp=ret.top_timestamp*1,//置顶则设置时间戳,不置顶时为0
        modify_timestamp=new Date().getTime()+8*60*60*1000,//修改时间戳
        hidden=ret.hidden*1,//是否隐藏
        id=ret.id;//文章id
        
    //校验参数完整性
    if(title.length>0
      && createDate.length>0
      && category.length>0
      && contentMD.length>0
      && contentHtml.length>0){
          
      contentText=contentHtml.replace(/<\/?[^>]*>/g,"").trim().substring(0,OPT.readMoreLength);//摘要
      //组装文章json
      let article={
        id:id,
        title:title,
        img:img,
        link:link,
        createDate:createDate,
        category:category,
        tags:tags,
        contentMD:contentMD,
        contentHtml:contentHtml,
        contentText:contentText,
        priority:priority,
        top_timestamp:top_timestamp,
        modify_timestamp:modify_timestamp,
        hidden:hidden,
        changefreq:changefreq
      };
      
      //将文章json写入KV（key为文章id，value为文章json字符串）
      await saveArticle(id,JSON.stringify(article));
      
      //组装文章json
      let articleWithoutHtml={
        id:id,
        title:title,
        img:img,
        link:link,
        createDate:createDate,
        category:category,
        tags:tags,
        contentText:contentText,
        priority:priority,
        top_timestamp:top_timestamp,
        modify_timestamp:modify_timestamp,
        hidden:hidden,
        changefreq:changefreq
      },
      articles_all=await getAllArticlesList();//读取文章列表
      //console.log(articles_all)
      //将原对象删掉，将最新的文章加入文章列表中，并重新按id排序后，再次回写到KV中
      for(var i=articles_all.length-1;i>=0;i--){//按索引删除，要倒序，否则索引值会变
        if(articles_all[i].id == id){
          articles_all.splice(i,1);
          break;
        }
      }
      articles_all.push(articleWithoutHtml),
      articles_all=sortArticle(articles_all),
      await saveArticlesList(JSON.stringify(articles_all))
      
      // 精确清理缓存
      let tagsToPurge = [`article_${id}`].concat(category).concat(tags);
      await purge(tagsToPurge);

      json = '{"msg":"Edit OK","rst":true,"id":"'+id+'"}'
    }else{
      json = '{"msg":"信息不全","rst":false}'
    }
  }
  
  // 只在 async function handle_admin 内部用 await
  if ("setting" == paths[1]) {
      let theme_html = await getThemeHtml("admin/setting"),
          categoryJson = await getWidgetCategory(),
          menuJson = await getWidgetMenu(),
          linkJson = await getWidgetLink(),
          tagJson = await getWidgetTags();
      html = Mustache.render(theme_html, {
          OPT,
          categoryJson,
          menuJson,
          linkJson,
          tagJson
      });
  }

  
  // 返回结果
  if(!json && !html && !file){
    json = '{"msg":"some errors","rst":false}'
  }
  if(file){
    return new Response(file.content,{
      headers:{
        "content-type":"application/octet-stream;charset=utf-8",
        "Content-Disposition":"attachment; filename="+file.name
      },
      status:200
    })
  }
  if(html){
    // 将CSRF令牌注入到HTML中
    if (csrfToken) {
      const csrfMetaTag = `<meta name="csrf-token" content="${csrfToken}">`;
      html = html.replace('</head>', `${csrfMetaTag}</head>`);
    }
    
    const response = new Response(html,{
      headers:{
        "content-type":"text/html;charset=UTF-8"
      },
      status:200
    });

    // 将CSRF令牌设置到cookie中
    if (csrfToken) {
      response.headers.append('Set-Cookie', `csrf-token=${csrfToken}; Path=/admin; SameSite=Strict`);
    }
    
    return response;
  }
  if(json){
    return new Response(json ,{
      headers:{
        "content-type":"application/json;charset=UTF-8"
      },
      status:200
    })
  }
}

/**------【④.抽丝剥茧，抽取公用的业务方法】-----**/

//访问管理后台或私密博客，则进行JWT Auth
async function parseBasicAuth(request){
    const cookies = request.headers.get('Cookie') || '';
    let token = '';
    
    cookies.split(';').forEach(cookie => {
      const [name, value] = cookie.trim().split('=');
      if (name === 'auth') {
        token = value;
      }
    });

    if (!token) {
        return false;
    }

    const payload = await verifyJWT(token, ACCOUNT.jwt_secret);
    
    // 如果payload不为null，则验证成功
    return payload !== null;
}

// 添加登录页面处理函数
async function handle_login(request) {
    const url = new URL(request.url);
    
    // 处理登录表单提交
    if (request.method === "POST") {
        const formData = await request.formData();
        const username = formData.get("username");
        const password = formData.get("password");
        
        if (username === ACCOUNT.user && password === ACCOUNT.password) {
            // 登录成功，生成JWT
            const token = await createJWT({ user: username }, ACCOUNT.jwt_secret);
            
            // 重定向到管理页面，并设置HttpOnly cookie
            return new Response("Login successful", {
                status: 302,
                headers: {
                    "Set-Cookie": `auth=${token}; HttpOnly; Path=/; SameSite=Strict; Secure`,
                    "Location": "/admin"
                }
            });
        } else {
            // 登录失败，返回登录页面并显示错误
            return renderLoginPage(true);
        }
    }
    
    // 显示登录页面
    return renderLoginPage(false);
}

// 登录页渲染
async function renderLoginPage(showError) {
    const template = await getThemeHtml("login");
    const html = Mustache.render(template, { OPT, showError });
    return new Response(html, { headers: { "content-type": "text/html;charset=UTF-8" } });
}

// 批量获取博客配置，用于前台渲染
async function getBlogConfig() {
  // 并行获取所有数据
  const [menus, categories, tags, links, articles_all] = await Promise.all([
    getWidgetMenu(),
    getWidgetCategory(),
    getWidgetTags(),
    getWidgetLink(),
    getArticlesList() // 这个函数已经过滤了隐藏文章
  ]);

  // 获取近期文章
  const articles_recently = await getRecentlyArticles(articles_all);

  return {
    menus,
    categories,
    tags,
    links,
    articles_all,
    articles_recently
  };
}

//获取所有【公开】文章：仅前台使用
async function getArticlesList(){
  let articles_all = await getAllArticlesList();
  
  // 过滤掉隐藏的文章
  return articles_all.filter(article => {
    // 确保article存在且hidden属性为0或undefined/null
    return article && !article.hidden;
  });
}

//文章排序：先按id倒排，再按置顶时间倒排
function sortArticle(articles){
  return sort(sort(articles,'id'),'top_timestamp');
}

//获取近期文章列表
async function getRecentlyArticles(articles){
  if(!articles){
    articles = await getArticlesList();
  }
  if(OPT.recentlyType == 2){//按修改时间倒序
    articles = sort([].concat(articles),'modify_timestamp');
  }
  let articles_recently = articles.slice(0,OPT.recentlySize);

  for(var i=0;i<articles_recently.length;i++){
      //调整文章的日期(yyyy-MM-dd)和url
      if(articles_recently[i].top_timestamp && !articles_recently[i].title.startsWith(OPT.top_flag)){
        articles_recently[i].title = OPT.top_flag + articles_recently[i].title
      }
      articles_recently[i].createDate10=articles_recently[i].createDate.substr(0,10),
      articles_recently[i].url="/article/"+articles_recently[i].id+"/"+articles_recently[i].link+".html";
  }
  return articles_recently;
}

//处理文章的属性信息：日期(yyyy-MM-dd)、年、月、日、内容长度和url
function processArticleProp(articles){
  for(var i=0;i<articles.length;i++){
    //调整文章的日期(yyyy-MM-dd)、文章长度和url
    if(articles[i]){
      // 添加置顶标记
      if(articles[i].top_timestamp && !articles[i].title.startsWith(OPT.top_flag)){
        articles[i].title = OPT.top_flag + articles[i].title;
      }
      // 不在这里添加隐藏标记，因为隐藏的文章不应该在前台显示
      
      //调整文章的日期(yyyy-MM-dd)、年、月、日、内容长度和url
      articles[i].createDate10=articles[i].createDate.substr(0,10);
      articles[i].createDateYear=articles[i].createDate.substr(0,4);
      articles[i].createDateMonth=articles[i].createDate.substr(5,7);
      articles[i].createDateDay=articles[i].createDate.substr(8,10);
      articles[i].contentLength=articles[i].contentText.length;
      
      // 修正URL生成逻辑，避免在link为空时产生多余的斜杠
      const linkPart = articles[i].link ? `/${articles[i].link}` : '';
      articles[i].url = `/article/${articles[i].id}${linkPart}.html`;
    }
  }
}
// 为HTML中的图片添加懒加载属性
function addLazyLoading(html) {
  // 使用正则表达式查找所有<img>标签，并添加loading="lazy"
  // 这个正则表达式会匹配<img>标签，并确保不会重复添加loading属性
  return html.replace(/&lt;img(?!.*?loading=)(.*?)&gt;/gi, '&lt;img loading="lazy"$1&gt;');
}


//获取前台模板源码, template_path:模板的相对路径
async function getThemeHtml(template_path){
  template_path = template_path.replace(".html", "");
  return THEMES[template_path] || '';
}

//根据文章id，返回上篇、下篇文章，文章内容页底部会用到
async function getSiblingArticle(id){
    id=("00000"+parseInt(id)).substr(-6);
    //读取文章列表，查找指定id的文章
    let articles_all = await getArticlesList(), // 这里已经过滤掉了隐藏文章
        article_idx = -1;
    
    // 获取文章内容
    let value = await getArticle(id);
    
    // 如果文章不存在或已隐藏，返回空数组
    if(null == value || value.hidden) {
        return [void 0, void 0, void 0];
    }
    
    // 查找当前文章在列表中的位置
    for(var i = 0, len = articles_all.length; i < len; i++) {
        if(articles_all[i].id == id) {
            article_idx = i;
            break;
        }
    }
    
    return [articles_all[article_idx-1], value, articles_all[article_idx+1]];
}

//清除缓存
async function purge(tags = []) {
  try {
    // 始终清除内存缓存
    MEMORY_CACHE.clear();
    
    // 如果没有提供cacheZoneId或cacheToken，则跳过CF缓存清理
    if (!ACCOUNT.cacheZoneId || !ACCOUNT.cacheToken) {
      console.log("未配置CF缓存清理参数，跳过。");
      return true;
    }

    // 如果没有提供tags，则清理所有缓存
    if (tags.length === 0) {
      tags = ['all']; // 使用一个特殊的tag来表示全部
    }

    const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${ACCOUNT.cacheZoneId}/purge_cache`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCOUNT.cacheToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ tags: tags })
    });

    const result = await response.json();
    if (result.success) {
      console.log("CF缓存清理成功:", tags);
      return true;
    } else {
      console.error("CF缓存清理失败:", result.errors);
      return false;
    }
  } catch(e) {
    console.error("缓存清除失败:", e);
    return false;
  }
}

//后台文章列表页的分页加载，返回[文章列表,是否无下一页]
async function admin_nextPage(pageNo,pageSize=OPT.pageSize){
  pageNo=pageNo<=1?1:pageNo;
  let articles_all=await getAllArticlesList(),
      articles=[];
  for(var i=(pageNo-1)*pageSize,s=Math.min(pageNo*pageSize,articles_all.length);i<s;i++){
    // 添加置顶标记
    if(articles_all[i].top_timestamp && !articles_all[i].title.startsWith(OPT.top_flag)){
      articles_all[i].title = OPT.top_flag + articles_all[i].title;
    }
    // 添加隐藏标记
    if(articles_all[i].hidden && !articles_all[i].title.startsWith(OPT.hidden_flag)){
      articles_all[i].title = OPT.hidden_flag + articles_all[i].title;
    }
    articles.push(articles_all[i]);
  }
  return articles;
}

//解析后台请求的参数
async function parseReq(request){
    const content_type=request.headers.get("content-type")||"";
    //json格式
    if(content_type.includes("application/json")){
    let json=JSON.stringify(await request.json()),
        content_type=JSON.parse(json),
        settings={category:[],top_timestamp:0, hidden:0};
        for(var i=0;i<content_type.length;i++){
            if("tags"==content_type[i].name){//标签，用逗号分隔
                settings[content_type[i].name]=content_type[i].value.split(",")
            }else if(content_type[i].name.includes("category")){
                settings.category.push(content_type[i].value)
            }else{
                settings[content_type[i].name]=content_type[i].value
            }
        }
        return settings
    }
    if(content_type.includes("application/text")){
        return await request.text();
    }
    if(content_type.includes("text/html")){
        return await request.text();
    }
    if(content_type.includes("form")){
        const formData=await request.formData(),
                ret={};
        for(const field of formData.entries())
            ret[field[0]]=field[1];
        return ret; // 这里直接返回对象，不要JSON.stringify(ret)
    }
    {
        const blob=await request.blob();
        return URL.createObjectURL(blob)
    }
}

//为文章分配ID
async function generateId(){
    //KV中读取文章数量（初始化为1），并格式化为6位，不足6位前面补零
    let article_id_seq=await getIndexNum();
    if(""===article_id_seq||null===article_id_seq||"[]"===article_id_seq||void 0===article_id_seq){
        await saveIndexNum(1)
        return "000001"
    }else{
        await saveIndexNum(parseInt(article_id_seq)+1)
        return ("00000"+(parseInt(article_id_seq)+1)).substr(-6)
    }
}

/**------【⑤.术业有专攻，读写KV方法集】-----**/

/* 【KV的Key的含义】
  SYSTEM_INDEX_LIST             文章列表(不包含内容)
  SYSTEM_INDEX_NUM              最新文章序号（不删除文章时，等于文章数量）
  SYSTEM_VALUE_WidgetMenu       导航栏
  SYSTEM_VALUE_WidgetCategory   分类目录
  SYSTEM_VALUE_WidgetTags       标签
  SYSTEM_VALUE_WidgetLink       链接
*/

// 在配置区域添加内存缓存对象
const MEMORY_CACHE = {
  data: {},
  get: function(key) {
    const item = this.data[key];
    if (!item) return null;
    if (item.expiry && item.expiry < Date.now()) {
      delete this.data[key];
      return null;
    }
    return item.value;
  },
  set: function(key, value, ttl = 300) { // 默认5分钟过期
    this.data[key] = {
      value: value,
      expiry: ttl ? Date.now() + (ttl * 1000) : null
    };
  },
  clear: function() {
    this.data = {};
  }
};

// 优化后的getKV函数，缓存已解析的JSON对象
async function getKV(key, toJson = false) {
    try {
        // 1. 先检查内存缓存
        const cachedValue = MEMORY_CACHE.get(key);
        if (cachedValue !== null) {
            return cachedValue;
        }

        // 2. 如果内存中没有，从KV读取
        console.log("KV读取, key:", key);
        const value = await CFBLOG.get(key);

        if (value === null) {
            return toJson ? [] : ""; // 对JSON返回空数组，对文本返回空字符串
        }

        // 3. 如果需要，解析JSON
        const result = toJson ? JSON.parse(value) : value;

        // 4. 将结果（可能是对象或字符串）存入内存缓存
        MEMORY_CACHE.set(key, result, 600); // 缓存10分钟

        return result;
    } catch (e) {
        console.error(`读取或解析KV失败: ${key}`, e);
        return toJson ? [] : ""; // 保证在任何错误情况下都返回安全默认值
    }
}

//KV读取，获取所有文章（含公开+隐藏）:仅后台使用
async function getAllArticlesList(){
  return await getKV("SYSTEM_INDEX_LIST", true);
}
//KV读取，最新文章序号（不删除文章时，等于文章数量），用于计算下个文章id
async function getIndexNum(){
  return await getKV("SYSTEM_INDEX_NUM", false); // 序号是数字，不应作为JSON解析
}
//KV读取，获取导航栏
async function getWidgetMenu(){
  return await getKV("SYSTEM_VALUE_WidgetMenu", true);
}
//KV读取，获取分类目录
async function getWidgetCategory(){
  return await getKV("SYSTEM_VALUE_WidgetCategory", true);
}
//KV读取，获取标签
async function getWidgetTags(){
  return await getKV("SYSTEM_VALUE_WidgetTags", true);
}
//KV读取，获取链接
async function getWidgetLink(){
  return await getKV("SYSTEM_VALUE_WidgetLink", true);
}
//KV读取，获取文章详细信息
async function getArticle(id){
  const cacheKey = `article_${id}`;
  const cachedArticle = MEMORY_CACHE.get(cacheKey);
  if (cachedArticle) return cachedArticle;
  
  const article = await getKV(id, true);
  if (article) {
    MEMORY_CACHE.set(cacheKey, article, 300); // 缓存5分钟
  }
  return article;
}

//写入KV，value如果未对象类型（数组或者json对象）需要序列化为字符串
async function saveKV(key,value){
    try {
        if(null!=value){
            if("object"==typeof value){
                value=JSON.stringify(value)
            }
            await CFBLOG.put(key,value);
            // 写入成功后，从内存缓存中删除该键
            MEMORY_CACHE.data[key] = null;
            console.log(`KV写入成功并清除缓存: ${key}`);
            return true
        }
        return false;
    } catch(e) {
        console.error(`保存KV失败: ${key}`, e);
        return false;
    }
}

//写入KV，获取所有文章（含公开+隐藏）:仅后台使用
async function saveArticlesList(value){
  return await saveKV("SYSTEM_INDEX_LIST",value);
}
//写入KV，最新文章序号（不删除文章时，等于文章数量），用于计算下个文章id
async function saveIndexNum(value){
  return await saveKV("SYSTEM_INDEX_NUM", value);
}
//写入KV，获取导航栏
async function saveWidgetMenu(value){
  return await saveKV("SYSTEM_VALUE_WidgetMenu", value);
}
//写入KV，获取分类目录
async function saveWidgetCategory(value){
  return await saveKV("SYSTEM_VALUE_WidgetCategory", value);
}
//写入KV，获取标签
async function saveWidgetTags(value){
  return await saveKV("SYSTEM_VALUE_WidgetTags", value);
}
//写入KV，获取链接
async function saveWidgetLink(value){
  return await saveKV("SYSTEM_VALUE_WidgetLink", value);
}
//写入KV，获取文章详细信息
async function saveArticle(id,value){
  return await saveKV(id, value);
}

/**------【⑥.站在巨人肩膀上，基础方法】-----**/

//扩展String的方法：
//trim清除前后空格
String.prototype.trim=function(t){
  return t?this.replace(new RegExp("^\\"+t+"+|\\"+t+"+$","g"),""):this.replace(/^\s+|\s+$/g,"")
}
//replaceHtmlPara替换<!--{参数}-->
String.prototype.replaceHtmlPara=function(t,e){
  return null!=e&&(e=e.replace(new RegExp("[$]","g"),"$$$$")),this.replace(new RegExp("\x3c!--{"+t+"}--\x3e","g"),e)
}
//replaceAll 替换全部
String.prototype.replaceAll=function(t,e){
  return this.replace(new RegExp(t,"g"),e)
}

//小于2位，前面补个0
function pad(t){
    return t>=0&&t<=9?"0"+t:t
}

//排序（默认倒序）
function sort(arr, field, desc=true){
    return arr.sort((function(m,n){
        var a=m[field]||'0',
            b=n[field]||'0';
        return desc?(a>b?-1:(a<b?1:0)):(a<b?-1:(a>b?1:0))
    }))
}

//undefined转空字符串
function nullToEmpty(k){
  return k==undefined?'':k
}

//判断格式:字符串是否为json，或者参数是否为对象
// --- JWT (JSON Web Token) 助手函数 ---

// Base64URL 编码
function base64urlEncode(str) {
  return btoa(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// Base64URL 解码
function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) {
    str += '=';
  }
  return atob(str);
}

// 创建JWT
async function createJWT(payload, secret, expirationInSeconds = 86400) { // 默认24小时过期
  // Header
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  // Payload
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now, // Issued at
    exp: now + expirationInSeconds, // Expiration time
  };

  // 编码
  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(fullPayload));

  const dataToSign = `${encodedHeader}.${encodedPayload}`;

  // 签名
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(dataToSign));
  
  const encodedSignature = base64urlEncode(String.fromCharCode(...new Uint8Array(signature)));

  return `${dataToSign}.${encodedSignature}`;
}

// 验证JWT
async function verifyJWT(token, secret) {
  try {
    const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
    if (!encodedHeader || !encodedPayload || !encodedSignature) {
      return null;
    }
    
    const dataToSign = `${encodedHeader}.${encodedPayload}`;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    // 解码签名
    const signature = Uint8Array.from(base64urlDecode(encodedSignature), c => c.charCodeAt(0));

    const isValid = await crypto.subtle.verify('HMAC', key, signature, new TextEncoder().encode(dataToSign));

    if (!isValid) {
      console.error("JWT 签名无效");
      return null;
    }

    const payload = JSON.parse(base64urlDecode(encodedPayload));

    // 检查过期时间
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      console.log("JWT已过期");
      return null;
    }

    return payload;
  } catch (error) {
    console.error("JWT验证出错:", error);
    return null;
  }
}
function checkFormat(t){
    if("string"==typeof t){
        try{
            var e=JSON.parse(t);
            return !("object"!=typeof e||!e)
        }catch(t){
            return false
        }
    }
    return !("object"!=typeof t||!t)
}

//引入mustache.js，4.1.0：https://cdn.bootcdn.net/ajax/libs/mustache.js/4.1.0/mustache.min.js
(function(global,factory){typeof exports==="object"&&typeof module!=="undefined"?module.exports=factory():typeof define==="function"&&define.amd?define(factory):(global=global||self,global.Mustache=factory())})(this,function(){"use strict";var objectToString=Object.prototype.toString;var isArray=Array.isArray||function isArrayPolyfill(object){return objectToString.call(object)==="[object Array]"};function isFunction(object){return typeof object==="function"}function typeStr(obj){return isArray(obj)?"array":typeof obj}function escapeRegExp(string){return string.replace(/[\-\[\]{}()*+?.,\\\^$|#\s]/g,"\\$&")}function hasProperty(obj,propName){return obj!=null&&typeof obj==="object"&&propName in obj}function primitiveHasOwnProperty(primitive,propName){return primitive!=null&&typeof primitive!=="object"&&primitive.hasOwnProperty&&primitive.hasOwnProperty(propName)}var regExpTest=RegExp.prototype.test;function testRegExp(re,string){return regExpTest.call(re,string)}var nonSpaceRe=/\S/;function isWhitespace(string){return!testRegExp(nonSpaceRe,string)}var entityMap={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;","/":"&#x2F;","`":"&#x60;","=":"&#x3D;"};function escapeHtml(string){return String(string).replace(/[&<>"'`=\/]/g,function fromEntityMap(s){return entityMap[s]})}var whiteRe=/\s*/;var spaceRe=/\s+/;var equalsRe=/\s*=/;var curlyRe=/\s*\}/;var tagRe=/#|\^|\/|>|\{|&|=|!/;function parseTemplate(template,tags){if(!template)return[];var lineHasNonSpace=false;var sections=[];var tokens=[];var spaces=[];var hasTag=false;var nonSpace=false;var indentation="";var tagIndex=0;function stripSpace(){if(hasTag&&!nonSpace){while(spaces.length)delete tokens[spaces.pop()]}else{spaces=[]}hasTag=false;nonSpace=false}var openingTagRe,closingTagRe,closingCurlyRe;function compileTags(tagsToCompile){if(typeof tagsToCompile==="string")tagsToCompile=tagsToCompile.split(spaceRe,2);if(!isArray(tagsToCompile)||tagsToCompile.length!==2)throw new Error("Invalid tags: "+tagsToCompile);openingTagRe=new RegExp(escapeRegExp(tagsToCompile[0])+"\\s*");closingTagRe=new RegExp("\\s*"+escapeRegExp(tagsToCompile[1]));closingCurlyRe=new RegExp("\\s*"+escapeRegExp("}"+tagsToCompile[1]))}compileTags(tags||mustache.tags);var scanner=new Scanner(template);var start,type,value,chr,token,openSection;while(!scanner.eos()){start=scanner.pos;value=scanner.scanUntil(openingTagRe);if(value){for(var i=0,valueLength=value.length;i<valueLength;++i){chr=value.charAt(i);if(isWhitespace(chr)){spaces.push(tokens.length);indentation+=chr}else{nonSpace=true;lineHasNonSpace=true;indentation+=" "}tokens.push(["text",chr,start,start+1]);start+=1;if(chr==="\n"){stripSpace();indentation="";tagIndex=0;lineHasNonSpace=false}}}if(!scanner.scan(openingTagRe))break;hasTag=true;type=scanner.scan(tagRe)||"name";scanner.scan(whiteRe);if(type==="="){value=scanner.scanUntil(equalsRe);scanner.scan(equalsRe);scanner.scanUntil(closingTagRe)}else if(type==="{"){value=scanner.scanUntil(closingCurlyRe);scanner.scan(curlyRe);scanner.scanUntil(closingTagRe);type="&"}else{value=scanner.scanUntil(closingTagRe)}if(!scanner.scan(closingTagRe))throw new Error("Unclosed tag at "+scanner.pos);if(type==">"){token=[type,value,start,scanner.pos,indentation,tagIndex,lineHasNonSpace]}else{token=[type,value,start,scanner.pos]}tagIndex++;tokens.push(token);if(type==="#"||type==="^"){sections.push(token)}else if(type==="/"){openSection=sections.pop();if(!openSection)throw new Error('Unopened section "'+value+'" at '+start);if(openSection[1]!==value)throw new Error('Unclosed section "'+openSection[1]+'" at '+start)}else if(type==="name"||type==="{"||type==="&"){nonSpace=true}else if(type==="="){compileTags(value)}}stripSpace();openSection=sections.pop();if(openSection)throw new Error('Unclosed section "'+openSection[1]+'" at '+scanner.pos);return nestTokens(squashTokens(tokens))}function squashTokens(tokens){var squashedTokens=[];var token,lastToken;for(var i=0,numTokens=tokens.length;i<numTokens;++i){token=tokens[i];if(token){if(token[0]==="text"&&lastToken&&lastToken[0]==="text"){lastToken[1]+=token[1];lastToken[3]=token[3]}else{squashedTokens.push(token);lastToken=token}}}return squashedTokens}function nestTokens(tokens){var nestedTokens=[];var collector=nestedTokens;var sections=[];var token,section;for(var i=0,numTokens=tokens.length;i<numTokens;++i){token=tokens[i];switch(token[0]){case"#":case"^":collector.push(token);sections.push(token);collector=token[4]=[];break;case"/":section=sections.pop();section[5]=token[2];collector=sections.length>0?sections[sections.length-1][4]:nestedTokens;break;default:collector.push(token)}}return nestedTokens}function Scanner(string){this.string=string;this.tail=string;this.pos=0}Scanner.prototype.eos=function eos(){return this.tail===""};Scanner.prototype.scan=function scan(re){var match=this.tail.match(re);if(!match||match.index!==0)return"";var string=match[0];this.tail=this.tail.substring(string.length);this.pos+=string.length;return string};Scanner.prototype.scanUntil=function scanUntil(re){var index=this.tail.search(re),match;switch(index){case-1:match=this.tail;this.tail="";break;case 0:match="";break;default:match=this.tail.substring(0,index);this.tail=this.tail.substring(index)}this.pos+=match.length;return match};function Context(view,parentContext){this.view=view;this.cache={".":this.view};this.parent=parentContext}Context.prototype.push=function push(view){return new Context(view,this)};Context.prototype.lookup=function lookup(name){var cache=this.cache;var value;if(cache.hasOwnProperty(name)){value=cache[name]}else{var context=this,intermediateValue,names,index,lookupHit=false;while(context){if(name.indexOf(".")>0){intermediateValue=context.view;names=name.split(".");index=0;while(intermediateValue!=null&&index<names.length){if(index===names.length-1)lookupHit=hasProperty(intermediateValue,names[index])||primitiveHasOwnProperty(intermediateValue,names[index]);intermediateValue=intermediateValue[names[index++]]}}else{intermediateValue=context.view[name];lookupHit=hasProperty(context.view,name)}if(lookupHit){value=intermediateValue;break}context=context.parent}cache[name]=value}if(isFunction(value))value=value.call(this.view);return value};function Writer(){this.templateCache={_cache:{},set:function set(key,value){this._cache[key]=value},get:function get(key){return this._cache[key]},clear:function clear(){this._cache={}}}}Writer.prototype.clearCache=function clearCache(){if(typeof this.templateCache!=="undefined"){this.templateCache.clear()}};Writer.prototype.parse=function parse(template,tags){var cache=this.templateCache;var cacheKey=template+":"+(tags||mustache.tags).join(":");var isCacheEnabled=typeof cache!=="undefined";var tokens=isCacheEnabled?cache.get(cacheKey):undefined;if(tokens==undefined){tokens=parseTemplate(template,tags);isCacheEnabled&&cache.set(cacheKey,tokens)}return tokens};Writer.prototype.render=function render(template,view,partials,config){var tags=this.getConfigTags(config);var tokens=this.parse(template,tags);var context=view instanceof Context?view:new Context(view,undefined);return this.renderTokens(tokens,context,partials,template,config)};Writer.prototype.renderTokens=function renderTokens(tokens,context,partials,originalTemplate,config){var buffer="";var token,symbol,value;for(var i=0,numTokens=tokens.length;i<numTokens;++i){value=undefined;token=tokens[i];symbol=token[0];if(symbol==="#")value=this.renderSection(token,context,partials,originalTemplate,config);else if(symbol==="^")value=this.renderInverted(token,context,partials,originalTemplate,config);else if(symbol===">")value=this.renderPartial(token,context,partials,config);else if(symbol==="&")value=this.unescapedValue(token,context);else if(symbol==="name")value=this.escapedValue(token,context,config);else if(symbol==="text")value=this.rawValue(token);if(value!==undefined)buffer+=value}return buffer};Writer.prototype.renderSection=function renderSection(token,context,partials,originalTemplate,config){var self=this;var buffer="";var value=context.lookup(token[1]);function subRender(template){return self.render(template,context,partials,config)}if(!value)return;if(isArray(value)){for(var j=0,valueLength=value.length;j<valueLength;++j){buffer+=this.renderTokens(token[4],context.push(value[j]),partials,originalTemplate,config)}}else if(typeof value==="object"||typeof value==="string"||typeof value==="number"){buffer+=this.renderTokens(token[4],context.push(value),partials,originalTemplate,config)}else if(isFunction(value)){if(typeof originalTemplate!=="string")throw new Error("Cannot use higher-order sections without the original template");value=value.call(context.view,originalTemplate.slice(token[3],token[5]),subRender);if(value!=null)buffer+=value}else{buffer+=this.renderTokens(token[4],context,partials,originalTemplate,config)}return buffer};Writer.prototype.renderInverted=function renderInverted(token,context,partials,originalTemplate,config){var value=context.lookup(token[1]);if(!value||isArray(value)&&value.length===0)return this.renderTokens(token[4],context,partials,originalTemplate,config)};Writer.prototype.indentPartial=function indentPartial(partial,indentation,lineHasNonSpace){var filteredIndentation=indentation.replace(/[^ \t]/g,"");var partialByNl=partial.split("\n");for(var i=0;i<partialByNl.length;i++){if(partialByNl[i].length&&(i>0||!lineHasNonSpace)){partialByNl[i]=filteredIndentation+partialByNl[i]}}return partialByNl.join("\n")};Writer.prototype.renderPartial=function renderPartial(token,context,partials,config){if(!partials)return;var tags=this.getConfigTags(config);var value=isFunction(partials)?partials(token[1]):partials[token[1]];if(value!=null){var lineHasNonSpace=token[6];var tagIndex=token[5];var indentation=token[4];var indentedValue=value;if(tagIndex==0&&indentation){indentedValue=this.indentPartial(value,indentation,lineHasNonSpace)}var tokens=this.parse(indentedValue,tags);return this.renderTokens(tokens,context,partials,indentedValue,config)}};Writer.prototype.unescapedValue=function unescapedValue(token,context){var value=context.lookup(token[1]);if(value!=null)return value};Writer.prototype.escapedValue=function escapedValue(token,context,config){var escape=this.getConfigEscape(config)||mustache.escape;var value=context.lookup(token[1]);if(value!=null)return typeof value==="number"&&escape===mustache.escape?String(value):escape(value)};Writer.prototype.rawValue=function rawValue(token){return token[1]};Writer.prototype.getConfigTags=function getConfigTags(config){if(isArray(config)){return config}else if(config&&typeof config==="object"){return config.tags}else{return undefined}};Writer.prototype.getConfigEscape=function getConfigEscape(config){if(config&&typeof config==="object"&&!isArray(config)){return config.escape}else{return undefined}};var mustache={name:"mustache.js",version:"4.1.0",tags:["{{","}}"],clearCache:undefined,escape:undefined,parse:undefined,render:undefined,Scanner:undefined,Context:undefined,Writer:undefined,set templateCache(cache){defaultWriter.templateCache=cache},get templateCache(){return defaultWriter.templateCache}};var defaultWriter=new Writer;mustache.clearCache=function clearCache(){return defaultWriter.clearCache()};mustache.parse=function parse(template,tags){return defaultWriter.parse(template,tags)};mustache.render=function render(template,view,partials,config){if(typeof template!=="string"){throw new TypeError('Invalid template! Template should be a "string" '+'but "'+typeStr(template)+'" was given as the first '+"argument for mustache#render(template, view, partials)")}return defaultWriter.render(template,view,partials,config)};mustache.escape=escapeHtml;mustache.Scanner=Scanner;mustache.Context=Context;mustache.Writer=Writer;return mustache});

