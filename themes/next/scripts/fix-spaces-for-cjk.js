hexo.extend.filter.register('after_render:html', fix); 

function fix(str) { return str.replace(/([¡«·»¿;·՚-՟։׀׃׆׳-״؉-؊،-؍؛؞-؟٪-٭۔܀-܍߷-߹।-॥॰෴๏๚-๛༄-༒྅࿐-࿔၊-၏჻፡-፨᙭-᙮᛫-᛭᜵-᜶។-៖៘-៚᠀-᠅᠇-᠊᥄-᥅᧞-᧟᨞-᨟᭚-᭠᰻-᰿᱾-᱿\u2000-\u206e⳹-⳼⳾-⳿⸀-\u2e7e⺀-\u2efe\u3000-〾・㇀-\u31ee㈀-㋾㌀-㏾㐀-\u4dbe一-\u9ffe꘍-꘏꙳꙾꡴-꡷꣎-꣏꤮-꤯꥟꩜-꩟豈-\ufafe︐-︖︙︰-﹎﹐-﹒﹔-﹗﹟-﹡﹨﹪-﹫！-＃％-＇＊，．-／：-；？-＠＼｡､-･]|[\ud840-\ud868\ud86a-\ud86c][\udc00-\udfff]|\ud800[\udd00-\udd01\udf9f\udfd0]|\ud802[\udd1f\udd3f\ude50-\ude58]|\ud809[\udc00-\udc7e]|\ud869[\udc00-\udede\udf00-\udfff]|\ud86d[\udc00-\udf3e\udf40-\udfff]|\ud86e[\udc00-\udc1e]|\ud87e[\udc00-\ude1e])\n\s*/g, '$1'); }