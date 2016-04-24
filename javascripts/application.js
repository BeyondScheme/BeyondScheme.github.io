window.BeyondScheme = {
  goToByScroll: function(obj, allowedMargin, upLimit) {
    var allowedMax, allowedMin, current, destination;
    if ($(obj).length > 0) {
      current = $(document).scrollTop();
      destination = $(obj).offset().top;
      allowedMin = destination - allowedMargin;
      allowedMax = destination + allowedMargin;
      if (destination >= upLimit) {
        destination -= upLimit;
      }
      if (current < allowedMin || current > allowedMax) {
        return $("html,body").animate({
          scrollTop: destination
        }, "slow");
      }
    }
  }
};

// binding
$(document).ready(function() {

  $('.x-scroll-contact').click(function(e) {
    // scroll smoothly to contact section when on homepage
    if (window.location.pathname == "/") {
      e.preventDefault();
      window.BeyondScheme.goToByScroll("#contact-section", 0, 0);
    }
  });

});
